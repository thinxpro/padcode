#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <CoreAudio/CoreAudio.h>
#import "permission.h"
#include <fcntl.h>
#include <math.h>
#include <signal.h>
#include <unistd.h>

// Microphone helper: JSON lines on stdout, control lines on stdin. Audio never leaves the output file.
static const double kRate = 16000;
// Dispatch sources and the recorder live until the process exits.
static NSMutableArray *retained;
static void output(NSDictionary *value) {
    @synchronized ([NSFileHandle class]) {
        NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
        fwrite(data.bytes, 1, data.length, stdout); fputc('\n', stdout); fflush(stdout);
    }
}
static void event(NSString *name, NSDictionary *fields) {
    NSMutableDictionary *value = [@{@"v": @1, @"event": name} mutableCopy];
    [value addEntriesFromDictionary:fields ?: @{}];
    output(value);
}
static int failure(NSString *code, NSString *message) {
    output(@{@"v": @1, @"ok": @NO, @"event": @"error", @"code": code, @"message": message});
    return 1;
}
static NSString *stringProperty(AudioObjectID object, AudioObjectPropertySelector selector) {
    AudioObjectPropertyAddress address = {selector, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    CFStringRef value = NULL; UInt32 size = sizeof(value);
    if (AudioObjectGetPropertyData(object, &address, 0, NULL, &size, &value) != noErr || !value) return nil;
    return (__bridge_transfer NSString *)value;
}
static NSString *transport(AudioDeviceID device) {
    AudioObjectPropertyAddress address = {kAudioDevicePropertyTransportType, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    UInt32 value = 0, size = sizeof(value);
    if (AudioObjectGetPropertyData(device, &address, 0, NULL, &size, &value) != noErr) return @"unknown";
    switch (value) {
        case kAudioDeviceTransportTypeBluetooth: case kAudioDeviceTransportTypeBluetoothLE: return @"bluetooth";
        case kAudioDeviceTransportTypeUSB: return @"usb";
        case kAudioDeviceTransportTypeBuiltIn: return @"built-in";
        default: return @"other";
    }
}
static UInt32 inputChannels(AudioDeviceID device) {
    AudioObjectPropertyAddress address = {kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyScopeInput, kAudioObjectPropertyElementMain};
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(device, &address, 0, NULL, &size) != noErr || size == 0) return 0;
    AudioBufferList *list = malloc(size);
    if (!list) return 0;
    UInt32 channels = 0;
    if (AudioObjectGetPropertyData(device, &address, 0, NULL, &size, list) == noErr)
        for (UInt32 i = 0; i < list->mNumberBuffers; ++i) channels += list->mBuffers[i].mNumberChannels;
    free(list);
    return channels;
}
static AudioDeviceID defaultInput(void) {
    AudioObjectPropertyAddress address = {kAudioHardwarePropertyDefaultInputDevice, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    AudioDeviceID device = kAudioObjectUnknown; UInt32 size = sizeof(device);
    AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &size, &device);
    return device;
}
static NSArray<NSDictionary *> *devices(void) {
    AudioObjectPropertyAddress address = {kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, NULL, &size) != noErr) return @[];
    UInt32 count = size / sizeof(AudioDeviceID);
    AudioDeviceID *ids = calloc(count ? count : 1, sizeof(AudioDeviceID));
    NSMutableArray *found = [NSMutableArray array];
    if (ids && AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &size, ids) == noErr) {
        AudioDeviceID fallback = defaultInput();
        for (UInt32 i = 0; i < count; ++i) {
            if (!inputChannels(ids[i])) continue;
            NSString *uid = stringProperty(ids[i], kAudioDevicePropertyDeviceUID);
            if (!uid.length) continue;
            [found addObject:@{@"id": uid, @"name": stringProperty(ids[i], kAudioObjectPropertyName) ?: @"Unnamed input", @"default": [NSNumber numberWithBool:ids[i] == fallback], @"transport": transport(ids[i]), @"object": @(ids[i])}];
        }
    }
    free(ids);
    return found;
}
static NSString *permissionStatus(void) {
    switch ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio]) {
        case AVAuthorizationStatusAuthorized: return @"authorized";
        case AVAuthorizationStatusDenied: return @"denied";
        case AVAuthorizationStatusRestricted: return @"restricted";
        default: return @"not-determined";
    }
}

@interface Recorder : NSObject
@property(strong) dispatch_queue_t queue;
@property(strong) NSMutableData *pcm;
@property(strong) AVAudioEngine *engine;
@property(strong) NSString *path;
@property int fd;
@property NSUInteger maxSamples;
@property float peak;
@property BOOL finished;
@property BOOL live;
@end
@implementation Recorder
- (void)append:(const int16_t *)samples count:(NSUInteger)count {
    if (self.finished) return;
    // Bluetooth headsets deliver digital silence while switching profiles. Recording, the level meter
    // and the length limit start with the first real sample, so speech is never lost to that switch.
    if (!self.live) {
        NSUInteger first = 0;
        while (first < count && samples[first] == 0) ++first;
        if (first == count) return;
        self.live = YES; event(@"live", nil);
        samples += first; count -= first;
    }
    NSUInteger room = self.maxSamples - self.pcm.length / 2;
    NSUInteger take = MIN(count, room);
    for (NSUInteger i = 0; i < take; ++i) self.peak = MAX(self.peak, fabsf(samples[i] / 32768.0f));
    [self.pcm appendBytes:samples length:take * 2];
    if (take < count || self.pcm.length / 2 >= self.maxSamples) [self finish:YES];
}
- (void)fail:(NSString *)code message:(NSString *)message {
    if (self.finished) return;
    self.finished = YES; [self.engine stop];
    unlink(self.path.fileSystemRepresentation); close(self.fd);
    exit(failure(code, message));
}
- (void)finish:(BOOL)save {
    if (self.finished) return;
    self.finished = YES; [self.engine stop];
    if (!save) { unlink(self.path.fileSystemRepresentation); close(self.fd); event(@"cancelled", nil); exit(0); }
    uint32_t bytes = (uint32_t)self.pcm.length;
    uint8_t header[44];
    uint32_t riff = 36 + bytes, fmtSize = 16, rate = (uint32_t)kRate, byteRate = (uint32_t)kRate * 2;
    uint16_t format = 1, channels = 1, align = 2, bits = 16;
    memcpy(header, "RIFF", 4); memcpy(header + 4, &riff, 4); memcpy(header + 8, "WAVEfmt ", 8);
    memcpy(header + 16, &fmtSize, 4); memcpy(header + 20, &format, 2); memcpy(header + 22, &channels, 2);
    memcpy(header + 24, &rate, 4); memcpy(header + 28, &byteRate, 4); memcpy(header + 32, &align, 2); memcpy(header + 34, &bits, 2);
    memcpy(header + 36, "data", 4); memcpy(header + 40, &bytes, 4);
    BOOL ok = write(self.fd, header, 44) == 44 && write(self.fd, self.pcm.bytes, bytes) == (ssize_t)bytes && fsync(self.fd) == 0;
    close(self.fd);
    if (!ok) { unlink(self.path.fileSystemRepresentation); exit(failure(@"io", @"Cannot write the recording.")); }
    event(@"stopped", @{@"seconds": @(bytes / 2 / kRate), @"bytes": @(bytes + 44)});
    exit(0);
}
@end

static int record(NSArray<NSString *> *args) {
    NSString *path = nil, *uid = nil; double maxSeconds = 60; BOOL synthetic = NO;
    for (NSUInteger i = 0; i < args.count; ++i) {
        NSString *arg = args[i];
        if ([arg isEqual:@"--synthetic"]) synthetic = YES;
        else if (i + 1 < args.count && [arg isEqual:@"--out"]) path = args[++i];
        else if (i + 1 < args.count && [arg isEqual:@"--device"]) uid = args[++i];
        else if (i + 1 < args.count && [arg isEqual:@"--max-seconds"]) maxSeconds = args[++i].doubleValue;
        else return failure(@"usage", @"Usage: padcode-audio record --out PATH [--device UID] [--max-seconds N] [--synthetic]");
    }
    if (!path.length || maxSeconds <= 0 || maxSeconds > 600) return failure(@"usage", @"record needs --out PATH and 0 < --max-seconds <= 600.");
    if (!synthetic) {
        NSString *status = permissionStatus();
        if ([status isEqual:@"denied"] || [status isEqual:@"restricted"])
            return failure(@"permission-denied", @"Microphone access is denied. Allow Padcode Audio in macOS Privacy & Security > Microphone, then retry.");
        if (![status isEqual:@"authorized"])
            return failure(@"permission-required", @"Microphone access has not been granted. Run padcode config and choose a microphone.");
    }
    int fd = open(path.fileSystemRepresentation, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) return failure(@"io", @"Cannot create the recording file; it must not already exist.");
    Recorder *recorder = [Recorder new];
    recorder.queue = dispatch_queue_create("padcode.audio", DISPATCH_QUEUE_SERIAL);
    recorder.pcm = [NSMutableData data]; recorder.path = path; recorder.fd = fd;
    recorder.maxSamples = (NSUInteger)(maxSeconds * kRate);
    signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN); signal(SIGPIPE, SIG_IGN);
    retained = [NSMutableArray arrayWithObject:recorder];
    const int stops[] = {SIGTERM, SIGINT};
    for (int i = 0; i < 2; ++i) {
        dispatch_source_t source = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, (uintptr_t)stops[i], 0, recorder.queue);
        dispatch_source_set_event_handler(source, ^{ [recorder finish:NO]; });
        dispatch_resume(source);
        [retained addObject:source];
    }
    __block NSMutableString *line = [NSMutableString string];
    dispatch_source_t input = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, STDIN_FILENO, 0, recorder.queue);
    dispatch_source_set_event_handler(input, ^{
        char buffer[256]; ssize_t count = read(STDIN_FILENO, buffer, sizeof(buffer));
        if (count <= 0) { [recorder finish:NO]; return; }
        [line appendString:[[NSString alloc] initWithBytes:buffer length:(NSUInteger)count encoding:NSASCIIStringEncoding] ?: @""];
        NSRange end;
        while ((end = [line rangeOfString:@"\n"]).location != NSNotFound) {
            NSString *command = [line substringToIndex:end.location];
            [line deleteCharactersInRange:NSMakeRange(0, end.location + 1)];
            if ([command isEqual:@"stop"]) [recorder finish:YES];
            else if ([command isEqual:@"cancel"]) [recorder finish:NO];
        }
        if (line.length > 64) [recorder finish:NO];
    });
    dispatch_resume(input);
    dispatch_source_t meter = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, recorder.queue);
    dispatch_source_set_timer(meter, dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), 100 * NSEC_PER_MSEC, 10 * NSEC_PER_MSEC);
    __block int waited = 0;
    dispatch_source_set_event_handler(meter, ^{
        if (recorder.finished) return;
        if (!recorder.live) {
            if (++waited >= 50) [recorder fail:@"no-signal" message:@"The microphone delivered no audio for 5 seconds. Check the device or choose another microphone."];
            return;
        }
        event(@"level", @{@"peak": @(round(recorder.peak * 100) / 100)}); recorder.peak = 0;
    });
    if (synthetic) {
        __block double phase = 0;
        dispatch_source_t tone = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, recorder.queue);
        dispatch_source_set_timer(tone, DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC, 5 * NSEC_PER_MSEC);
        dispatch_source_set_event_handler(tone, ^{
            int16_t samples[1600];
            for (int i = 0; i < 1600; ++i) { samples[i] = (int16_t)(sin(phase) * 0.3 * 32767); phase += 2 * M_PI * 440 / kRate; }
            [recorder append:samples count:1600];
        });
        [retained addObject:tone];
        event(@"started", @{@"synthetic": @YES});
        dispatch_resume(tone);
    } else {
        NSArray *inputs = devices();
        NSDictionary *chosen = nil;
        for (NSDictionary *device in inputs) if (uid ? [device[@"id"] isEqual:uid] : [device[@"default"] boolValue]) chosen = device;
        if (!chosen) { unlink(path.fileSystemRepresentation); close(fd); return failure(@"no-device", uid ? @"The configured microphone is not connected." : @"No microphone is available."); }
        AudioDeviceID device = [chosen[@"object"] unsignedIntValue];
        AVAudioEngine *engine = [AVAudioEngine new];
        recorder.engine = engine;
        AVAudioInputNode *node = engine.inputNode;
        if (AudioUnitSetProperty(node.audioUnit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &device, sizeof(device)) != noErr) {
            unlink(path.fileSystemRepresentation); close(fd); return failure(@"no-device", @"Cannot open the selected microphone.");
        }
        AVAudioFormat *source = [node inputFormatForBus:0];
        AVAudioFormat *target = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16 sampleRate:kRate channels:1 interleaved:YES];
        AVAudioConverter *converter = source.sampleRate > 0 && source.channelCount > 0 ? [[AVAudioConverter alloc] initFromFormat:source toFormat:target] : nil;
        if (!converter) { unlink(path.fileSystemRepresentation); close(fd); return failure(@"no-device", @"The selected microphone reports no usable input format."); }
        AVAudioNodeTapBlock tap = ^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
            (void)when;
            AVAudioFrameCount capacity = (AVAudioFrameCount)ceil(buffer.frameLength * kRate / source.sampleRate) + 64;
            AVAudioPCMBuffer *converted = [[AVAudioPCMBuffer alloc] initWithPCMFormat:target frameCapacity:capacity];
            __block BOOL supplied = NO; NSError *error = nil;
            [converter convertToBuffer:converted error:&error withInputFromBlock:^AVAudioBuffer *(AVAudioPacketCount count, AVAudioConverterInputStatus *status) {
                (void)count;
                if (supplied) { *status = AVAudioConverterInputStatus_NoDataNow; return nil; }
                supplied = YES; *status = AVAudioConverterInputStatus_HaveData; return buffer;
            }];
            if (error || !converted.frameLength) return;
            NSData *copy = [NSData dataWithBytes:converted.int16ChannelData[0] length:converted.frameLength * 2];
            dispatch_async(recorder.queue, ^{ [recorder append:copy.bytes count:copy.length / 2]; });
        };
        BOOL tapped = YES;
#if defined(__MAC_27_0) && __MAC_OS_X_VERSION_MAX_ALLOWED >= __MAC_27_0
        if (@available(macOS 27.0, *)) tapped = [node installTapOnBus:0 bufferSize:1024 format:source error:nil block:tap];
        else
#endif
        {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            [node installTapOnBus:0 bufferSize:1024 format:source block:tap];
#pragma clang diagnostic pop
        }
        if (!tapped) { unlink(path.fileSystemRepresentation); close(fd); return failure(@"io", @"Cannot attach to the microphone input."); }
        AudioObjectPropertyAddress alive = {kAudioDevicePropertyDeviceIsAlive, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
        AudioObjectAddPropertyListenerBlock(device, &alive, recorder.queue, ^(UInt32 count, const AudioObjectPropertyAddress *addresses) {
            (void)count; (void)addresses;
            UInt32 value = 1, size = sizeof(value);
            if (AudioObjectGetPropertyData(device, &alive, 0, NULL, &size, &value) != noErr || !value) [recorder fail:@"device-lost" message:@"The microphone was disconnected."];
        });
        [[NSNotificationCenter defaultCenter] addObserverForName:AVAudioEngineConfigurationChangeNotification object:engine queue:nil usingBlock:^(NSNotification *note) {
            (void)note; dispatch_async(recorder.queue, ^{ [recorder fail:@"device-lost" message:@"The microphone configuration changed during recording."]; });
        }];
        NSError *error = nil;
        [engine prepare];
        if (![engine startAndReturnError:&error]) { unlink(path.fileSystemRepresentation); close(fd); return failure(@"io", @"Cannot start microphone capture."); }
        event(@"started", @{@"name": chosen[@"name"]});
    }
    dispatch_resume(meter);
    [retained addObjectsFromArray:@[meter, input]];
    dispatch_main();
}

int main(int argc, const char **argv) {
    @autoreleasepool {
        BOOL handedOff = argc > 1 && strcmp(argv[1], "--permission-owner") == 0;
        if (handedOff) { ++argv; --argc; }
        NSString *command = argc > 1 ? @(argv[1]) : @"";
        NSMutableArray<NSString *> *rest = [NSMutableArray array];
        for (int i = 2; i < argc; ++i) [rest addObject:@(argv[i])];
        if ([command isEqual:@"list"] && !rest.count) {
            NSMutableArray *visible = [NSMutableArray array];
            for (NSDictionary *device in devices()) [visible addObject:@{@"id": device[@"id"], @"name": device[@"name"], @"default": device[@"default"], @"transport": device[@"transport"]}];
            output(@{@"v": @1, @"ok": @YES, @"devices": visible});
            return 0;
        }
        if (![@[@"permission", @"request", @"record", @"diagnose"] containsObject:command] || (![command isEqual:@"record"] && rest.count))
            return failure(@"usage", @"Usage: padcode-audio list | permission | request | diagnose | record --out PATH [--device UID] [--max-seconds N]");
        NSString *permissionError = preparePermissionOwner(argc, argv, handedOff, @"NSMicrophoneUsageDescription", @"microphone");
        if (permissionError) return failure(@"permission-host", permissionError);
        if ([command isEqual:@"diagnose"]) {
            output(@{@"v": @1, @"ok": @YES, @"selfResponsible": @YES, @"usageDescription": @YES, @"pid": @(getpid())});
            return 0;
        }
        if ([command isEqual:@"permission"]) { output(@{@"v": @1, @"ok": @YES, @"status": permissionStatus()}); return 0; }
        if ([command isEqual:@"request"]) {
            if (![permissionStatus() isEqual:@"not-determined"]) { output(@{@"v": @1, @"ok": @YES, @"status": permissionStatus()}); return 0; }
            [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) {
                (void)granted; output(@{@"v": @1, @"ok": @YES, @"status": permissionStatus()}); exit(0);
            }];
            dispatch_main();
        }
        return record(rest);
    }
}
