#import "discovery.h"
#include <time.h>
#include <unistd.h>

static double monotonicSeconds(void) {
    struct timespec now; clock_gettime(CLOCK_MONOTONIC, &now);
    return now.tv_sec + now.tv_nsec / 1e9;
}
static void traceScan(const char *phase) {
    if (getenv("PADCODE_BLUETOOTH_DEBUG")) { fprintf(stderr, "Bluetooth scan: %s\n", phase); fflush(stderr); }
}
static NSDictionary *discoveryFailure(NSString *code, NSString *message) {
    return @{@"v": @1, @"ok": @NO, @"code": code, @"message": message};
}
@interface Discovery : NSObject <IOBluetoothDeviceInquiryDelegate>
@property BOOL started;
@property BOOL done;
@property BOOL aborted;
@property IOReturn error;
@property(strong) NSMutableDictionary *devices;
@end
@implementation Discovery
- (instancetype)init { self = [super init]; if (self) _devices = [NSMutableDictionary dictionary]; return self; }
- (void)deviceInquiryStarted:(IOBluetoothDeviceInquiry *)sender { (void)sender; self.started = YES; traceScan("inquiry-started"); }
- (void)deviceInquiryDeviceFound:(IOBluetoothDeviceInquiry *)sender device:(IOBluetoothDevice *)device {
    (void)sender;
    traceScan("device-found");
    // Do not request remote names inside inquiry callbacks.
    if (device.addressString) self.devices[device.addressString] = device;
}
- (void)deviceInquiryComplete:(IOBluetoothDeviceInquiry *)sender error:(IOReturn)error aborted:(BOOL)aborted {
    (void)sender; self.error = error; self.aborted = aborted; self.done = YES; traceScan("inquiry-complete");
}
@end

NSDictionary *discoverBluetooth(id<PadcodeInquiry> inquiry, NSTimeInterval timeout,
                               volatile sig_atomic_t *cancelled) {
    if (!inquiry) return discoveryFailure(@"scan-unavailable", @"macOS could not create a Bluetooth inquiry. Retry after checking Bluetooth availability.");
    Discovery *state = [Discovery new];
    inquiry.delegate = state;
    inquiry.inquiryLength = 8;
    inquiry.updateNewDeviceNames = NO;
    pid_t parent = getppid();
    double deadline = monotonicSeconds() + timeout;
    traceScan("request-start");
    IOReturn result = *cancelled ? kIOReturnAborted : [inquiry start];
    traceScan("start-returned");
    while (result == kIOReturnSuccess && !state.done && !*cancelled && getppid() == parent && monotonicSeconds() < deadline) {
        [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
    }
    // Detach before stop: a stop callback must not overwrite the actual outcome.
    inquiry.delegate = nil;
    traceScan("request-stop");
    [inquiry stop];
    traceScan("stop-returned");
    if (*cancelled || getppid() != parent) return discoveryFailure(@"cancelled", @"Bluetooth discovery was cancelled.");
    if (result != kIOReturnSuccess) return discoveryFailure(@"scan-start", [NSString stringWithFormat:@"Bluetooth discovery could not start (%d). Wait 15 seconds before retrying; macOS may throttle repeated scans.", result]);
    if (state.aborted) return discoveryFailure(@"scan-aborted", @"macOS aborted Bluetooth discovery. Close other Bluetooth discovery windows, wait 15 seconds, then retry.");

    // Some OS versions retain results even if a delegate notification is delayed.
    traceScan("read-found-devices");
    for (IOBluetoothDevice *device in [inquiry foundDevices]) {
        if (device.addressString) state.devices[device.addressString] = device;
    }
    BOOL nativeError = state.done && state.error != kIOReturnSuccess;
    if (nativeError && state.devices.count == 0) return discoveryFailure(@"scan-error", [NSString stringWithFormat:@"Bluetooth discovery failed (%d) without finding devices. Check Bluetooth availability and retry after 15 seconds.", state.error]);
    BOOL complete = state.done && !nativeError;
    if (!complete && state.devices.count == 0) {
        return discoveryFailure(state.started ? @"scan-timeout" : @"scan-not-started", state.started
            ? @"Bluetooth scan reached its deadline without finding nearby devices. macOS did not report completion. Keep SHARE + PS pairing active, close other discovery windows, wait 15 seconds, then retry."
            : @"macOS did not report that discovery started before the deadline (it may be throttled). Close other Bluetooth discovery windows, wait 15 seconds, then retry with SHARE + PS pairing active.");
    }
    traceScan("serialize-cached-devices");
    NSMutableArray *devices = [NSMutableArray array];
    for (NSString *key in [[state.devices allKeys] sortedArrayUsingSelector:@selector(compare:)]) {
        IOBluetoothDevice *device = state.devices[key];
        // name reads cached metadata; no remoteNameRequest is issued.
        NSString *name = device.name;
        [devices addObject:@{@"address": key, @"name": name.length ? name : @"Unnamed Bluetooth device",
                            @"paired": @(device.isPaired), @"connected": @(device.isConnected)}];
    }
    return @{@"v": @1, @"ok": @YES, @"powered": @YES, @"devices": devices,
             @"scan": @{@"complete": @(complete), @"started": @(state.started),
                        @"discovered": @(devices.count), @"reason": complete ? @"complete" : nativeError ? @"native-error" : @"deadline", @"nativeError": @(nativeError ? state.error : 0)}};
}
