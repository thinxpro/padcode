#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <CoreAudio/CoreAudio.h>
#import <Speech/Speech.h>
#import "permission.h"
#import "recording.h"
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

static NSString *speechStatus(void) {
    switch ([SFSpeechRecognizer authorizationStatus]) {
        case SFSpeechRecognizerAuthorizationStatusAuthorized: return @"authorized";
        case SFSpeechRecognizerAuthorizationStatusDenied: return @"denied";
        case SFSpeechRecognizerAuthorizationStatusRestricted: return @"restricted";
        default: return @"not-determined";
    }
}
// On-device only: a language without an on-device model is reported as unsupported, never sent to a server.
static int transcribe(NSArray<NSString *> *args) {
    NSString *file = nil, *language = nil;
    for (NSUInteger i = 0; i + 1 < args.count; i += 2) {
        if ([args[i] isEqual:@"--file"]) file = args[i + 1];
        else if ([args[i] isEqual:@"--language"]) language = args[i + 1];
        else return failure(@"usage", @"Usage: padcode-audio transcribe --file PATH --language LOCALE");
    }
    if (!file.length || !language.length || args.count % 2) return failure(@"usage", @"Usage: padcode-audio transcribe --file PATH --language LOCALE");
    NSLocale *locale = [language isEqual:@"auto"] ? [NSLocale currentLocale] : [NSLocale localeWithLocaleIdentifier:language];
    SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];
    if (!recognizer || !recognizer.supportsOnDeviceRecognition)
        return failure(@"unsupported-language", [NSString stringWithFormat:@"macOS has no on-device speech model for %@. Choose another language or use whisper.cpp.", locale.localeIdentifier]);
    NSString *status = speechStatus();
    if ([status isEqual:@"denied"] || [status isEqual:@"restricted"])
        return failure(@"speech-permission-denied", @"Speech recognition is denied. Allow Padcode Audio in System Settings > Privacy & Security > Speech Recognition.");
    if (![status isEqual:@"authorized"]) return failure(@"speech-permission-required", @"Speech recognition has not been granted to Padcode Audio yet.");
    if (!recognizer.isAvailable) return failure(@"unavailable", @"macOS speech recognition is not available right now.");
    SFSpeechURLRecognitionRequest *request = [[SFSpeechURLRecognitionRequest alloc] initWithURL:[NSURL fileURLWithPath:file]];
    request.requiresOnDeviceRecognition = YES;
    request.shouldReportPartialResults = NO;
    if (@available(macOS 13.0, *)) request.addsPunctuation = YES;
    signal(SIGTERM, SIG_IGN);
    dispatch_source_t term = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGTERM, 0, dispatch_get_main_queue());
    dispatch_source_set_event_handler(term, ^{ exit(failure(@"cancelled", @"Transcription cancelled.")); });
    dispatch_resume(term);
    retained = [NSMutableArray arrayWithObjects:recognizer, request, term, nil];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ exit(failure(@"timeout", @"Transcription took longer than 120 seconds.")); });
    SFSpeechRecognitionTask *task = [recognizer recognitionTaskWithRequest:request resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
        if (error) {
            // 1110: no speech detected; an empty draft is a valid result.
            if (error.code == 1110) { output(@{@"v": @1, @"ok": @YES, @"text": @""}); exit(0); }
            exit(failure(@"transcription", error.localizedDescription ?: @"Speech recognition failed."));
        }
        if (result.isFinal) { output(@{@"v": @1, @"ok": @YES, @"text": result.bestTranscription.formattedString ?: @""}); exit(0); }
    }];
    [retained addObject:task];
    dispatch_main();
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
    self.finished = YES; if (self.live) [self.engine stop];
    unlink(self.path.fileSystemRepresentation); close(self.fd);
    _exit(failure(code, message));
}
- (void)finish:(BOOL)save {
    if (self.finished) return;
    self.finished = YES; if (self.live) [self.engine stop];
    if (!save) { unlink(self.path.fileSystemRepresentation); close(self.fd); event(@"cancelled", nil); _exit(0); }
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
    if (!ok) { unlink(self.path.fileSystemRepresentation); _exit(failure(@"io", @"Cannot write the recording.")); }
    event(@"stopped", @{@"seconds": @(bytes / 2 / kRate), @"bytes": @(bytes + 44)});
    _exit(0);
}
@end

static int record(NSArray<NSString *> *args) {
    NSString *path = nil, *uid = nil; double maxSeconds = 60, startLimit = 6; BOOL synthetic = NO, silent = NO;
    for (NSUInteger i = 0; i < args.count; ++i) {
        NSString *arg = args[i];
        if ([arg isEqual:@"--synthetic"]) synthetic = YES;
        else if ([arg isEqual:@"--synthetic-silence"]) synthetic = silent = YES;
        else if (i + 1 < args.count && [arg isEqual:@"--start-timeout"]) startLimit = args[++i].doubleValue;
        else if (i + 1 < args.count && [arg isEqual:@"--out"]) path = args[++i];
        else if (i + 1 < args.count && [arg isEqual:@"--device"]) uid = args[++i];
        else if (i + 1 < args.count && [arg isEqual:@"--max-seconds"]) maxSeconds = args[++i].doubleValue;
        else return failure(@"usage", @"Usage: padcode-audio record --out PATH [--device UID] [--max-seconds N] [--synthetic]");
    }
    if (!path.length || maxSeconds <= 0 || maxSeconds > 600 || startLimit <= 0 || startLimit > 60) return failure(@"usage", @"record needs --out PATH, 0 < --max-seconds <= 600 and 0 < --start-timeout <= 60.");
    if (!synthetic) {
        NSString *status = permissionStatus();
        if ([status isEqual:@"denied"] || [status isEqual:@"restricted"])
            return failure(@"permission-denied", @"Microphone access is denied. Allow Padcode Audio in macOS Privacy & Security > Microphone, then retry.");
        if (![status isEqual:@"authorized"])
            return failure(@"permission-required", @"Microphone access has not been granted to Padcode Audio yet.");
    }
    int fd = open(path.fileSystemRepresentation, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) return failure(@"io", @"Cannot create the recording file; it must not already exist.");
    Recorder *recorder = [Recorder new];
    recorder.queue = dispatch_queue_create("padcode.audio", DISPATCH_QUEUE_SERIAL);
    recorder.pcm = [NSMutableData data]; recorder.path = path; recorder.fd = fd;
    recorder.maxSamples = (NSUInteger)(maxSeconds * kRate);
    signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN); signal(SIGPIPE, SIG_IGN);
    retained = [NSMutableArray arrayWithObject:recorder];
    // Watchdog on its own queue: a device that hangs while opening (for example a Bluetooth headset that
    // just reconnected) must still end the helper, even if AVAudioEngine never returns.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(startLimit * NSEC_PER_SEC)), dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        if (!recorder.live && !recorder.finished)
            [recorder fail:@"no-signal" message:@"The microphone did not start. Reconnect it, or choose another microphone in Voice settings."];
    });
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
    dispatch_source_set_event_handler(meter, ^{
        if (recorder.finished || !recorder.live) return;
        event(@"level", @{@"peak": @(round(recorder.peak * 100) / 100)}); recorder.peak = 0;
    });
    if (synthetic) {
        __block double phase = 0;
        dispatch_source_t tone = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, recorder.queue);
        dispatch_source_set_timer(tone, DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC, 5 * NSEC_PER_MSEC);
        dispatch_source_set_event_handler(tone, ^{
            int16_t samples[1600];
            for (int i = 0; i < 1600; ++i) { samples[i] = silent ? 0 : (int16_t)(sin(phase) * 0.3 * 32767); phase += 2 * M_PI * 440 / kRate; }
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
        AVAudioFormat *target = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16 sampleRate:kRate channels:1 interleaved:YES];
        // Builds the whole input chain for the device's current format; runs again after a configuration change.
        NSString *(^attach)(void) = ^NSString *(void) {
            AudioDeviceID selected = device;
            if (AudioUnitSetProperty(node.audioUnit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &selected, sizeof(selected)) != noErr) return @"Cannot open the selected microphone.";
            AVAudioFormat *source = [node inputFormatForBus:0];
            AVAudioConverter *converter = source.sampleRate > 0 && source.channelCount > 0 ? [[AVAudioConverter alloc] initFromFormat:source toFormat:target] : nil;
            if (!converter) return @"The selected microphone reports no usable input format.";
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
            if (!tapped) return @"Cannot attach to the microphone input.";
            NSError *error = nil;
            [engine prepare];
            return [engine startAndReturnError:&error] ? nil : @"Cannot start microphone capture.";
        };
        NSString *problem = attach();
        if (problem) { unlink(path.fileSystemRepresentation); close(fd); return failure([problem hasPrefix:@"Cannot start"] || [problem hasPrefix:@"Cannot attach"] ? @"io" : @"no-device", problem); }
        AudioObjectPropertyAddress alive = {kAudioDevicePropertyDeviceIsAlive, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
        AudioObjectAddPropertyListenerBlock(device, &alive, recorder.queue, ^(UInt32 count, const AudioObjectPropertyAddress *addresses) {
            (void)count; (void)addresses;
            UInt32 value = 1, size = sizeof(value);
            if (AudioObjectGetPropertyData(device, &alive, 0, NULL, &size, &value) != noErr || !value) [recorder fail:@"device-lost" message:@"The microphone was disconnected."];
        });
        // Starting capture often changes the device format (a Bluetooth headset switching to its call profile,
        // or the first capture after a privacy grant). Before audio is live, rebuild the chain instead of failing.
        __block int restarts = 0;
        [[NSNotificationCenter defaultCenter] addObserverForName:AVAudioEngineConfigurationChangeNotification object:engine queue:nil usingBlock:^(NSNotification *note) {
            (void)note;
            dispatch_async(recorder.queue, ^{
                if (recorder.finished) return;
                if (padcodeConfigChangeAction(recorder.live, restarts) == PadcodeConfigFail) {
                    [recorder fail:@"device-lost" message:@"The microphone configuration changed during recording."];
                    return;
                }
                ++restarts;
                [engine stop];
                [node removeTapOnBus:0];
                NSString *again = attach();
                if (again) [recorder fail:@"device-lost" message:again];
            });
        }];
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
        NSArray *withArguments = @[@"record", @"transcribe"];
        if (![@[@"permission", @"request", @"record", @"diagnose", @"speech-permission", @"speech-request", @"transcribe"] containsObject:command] || (![withArguments containsObject:command] && rest.count))
            return failure(@"usage", @"Usage: padcode-audio list | permission | request | speech-permission | speech-request | diagnose | record --out PATH [--device UID] [--max-seconds N] | transcribe --file PATH --language LOCALE");
        NSString *permissionError = preparePermissionOwner(argc, argv, handedOff, @"NSMicrophoneUsageDescription", @"microphone");
        if (permissionError) return failure(@"permission-host", permissionError);
        if ([command isEqual:@"diagnose"]) {
            output(@{@"v": @1, @"ok": @YES, @"selfResponsible": @YES, @"usageDescription": @YES, @"pid": @(getpid())});
            return 0;
        }
        if ([command isEqual:@"permission"]) { output(@{@"v": @1, @"ok": @YES, @"status": permissionStatus()}); return 0; }
        if ([command isEqual:@"speech-permission"]) { output(@{@"v": @1, @"ok": @YES, @"status": speechStatus()}); return 0; }
        if ([command isEqual:@"speech-request"]) {
            if (![speechStatus() isEqual:@"not-determined"]) { output(@{@"v": @1, @"ok": @YES, @"status": speechStatus()}); return 0; }
            [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus value) {
                (void)value; output(@{@"v": @1, @"ok": @YES, @"status": speechStatus()}); exit(0);
            }];
            dispatch_main();
        }
        if ([command isEqual:@"transcribe"]) return transcribe(rest);
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
