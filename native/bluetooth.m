#import <Foundation/Foundation.h>
#import <IOBluetooth/IOBluetooth.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import "permission.h"
#import "discovery.h"
#include <signal.h>
#include <unistd.h>

static volatile sig_atomic_t interrupted = 0;
static void stopOperation(int signalNumber) { (void)signalNumber; interrupted = 1; }
static void output(NSDictionary *value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    fwrite(data.bytes, 1, data.length, stdout);
    fputc('\n', stdout);
    fflush(stdout);
}
static int failure(NSString *code, NSString *message) {
    output(@{@"v": @1, @"ok": @NO, @"code": code, @"message": message});
    return 1;
}
static NSDictionary *describe(IOBluetoothDevice *device) {
    return @{@"address": device.addressString ?: @"", @"name": device.name ?: @"Unnamed Bluetooth device",
             @"paired": @([device isPaired]), @"connected": @([device isConnected])};
}
@interface Operation : NSObject <IOBluetoothDevicePairDelegate>
@property BOOL done;
@property IOReturn error;
@property BOOL challenge;
@property(strong) NSMutableDictionary<NSString *, IOBluetoothDevice *> *devices;
@end
@implementation Operation
- (instancetype)init {
    self = [super init];
    if (self) _devices = [NSMutableDictionary dictionary];
    return self;
}
- (void)devicePairingFinished:(id)sender error:(IOReturn)error {
    (void)sender; self.error = error; self.done = YES;
}
- (void)devicePairingPINCodeRequest:(id)sender {
    (void)sender; self.challenge = YES; self.done = YES;
}
- (void)devicePairingUserConfirmationRequest:(id)sender numericValue:(BluetoothNumericValue)value {
    (void)value; [sender replyUserConfirmation:NO]; self.challenge = YES; self.done = YES;
}
- (void)devicePairingUserPasskeyNotification:(id)sender passkey:(BluetoothPasskey)value {
    (void)sender; (void)value; self.challenge = YES; self.done = YES;
}
- (void)connectionComplete:(IOBluetoothDevice *)device status:(IOReturn)status {
    (void)device; self.error = status; self.done = YES;
}
@end

static BOOL waitForOperation(Operation *operation, NSTimeInterval seconds) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:seconds];
    pid_t parent = getppid();
    while (!operation.done && !interrupted && getppid() == parent && deadline.timeIntervalSinceNow > 0) {
        [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    }
    return operation.done && !interrupted && getppid() == parent;
}

int main(int argc, const char **argv) {
    @autoreleasepool {
        BOOL handedOff = argc > 1 && strcmp(argv[1], "--permission-owner") == 0;
        if (handedOff) { ++argv; --argc; }
        NSString *command = argc > 1 ? @(argv[1]) : @"";
        BOOL deviceCommand = [command isEqual:@"pair"] || [command isEqual:@"connect"];
        if ((!deviceCommand && ![command isEqual:@"status"] && ![command isEqual:@"scan"] && ![command isEqual:@"diagnose-permission"]) || argc != (deviceCommand ? 3 : 2)) {
            return failure(@"usage", @"Usage: padcode-bluetooth status | scan | pair ADDRESS | connect ADDRESS");
        }
        NSString *address = deviceCommand ? @(argv[2]) : nil;
        NSPredicate *validAddress = [NSPredicate predicateWithFormat:@"SELF MATCHES %@", @"(?i)[0-9a-f]{2}([:-][0-9a-f]{2}){5}"];
        if (address && ![validAddress evaluateWithObject:address]) return failure(@"address", @"Invalid Bluetooth address.");
        NSString *permissionError = prepareBluetoothPermission(argc, argv, handedOff);
        if (permissionError) return failure(@"permission-host", permissionError);
        if ([command isEqual:@"diagnose-permission"]) {
            output(@{@"v": @1, @"ok": @YES, @"selfResponsible": @YES, @"usageDescription": @YES, @"pid": @(getpid())});
            return 0;
        }
        signal(SIGINT, stopOperation); signal(SIGTERM, stopOperation);
        if ([CBManager authorization] == CBManagerAuthorizationDenied || [CBManager authorization] == CBManagerAuthorizationRestricted) {
            return failure(@"permission", @"Bluetooth permission is denied. Allow padcode-bluetooth in macOS Privacy & Security > Bluetooth, then retry.");
        }
        if (getenv("PADCODE_BLUETOOTH_DEBUG")) fprintf(stderr, "Bluetooth scan: host-query\n");
        IOBluetoothHostController *host = [IOBluetoothHostController defaultController];
        if (!host || host.powerState != kBluetoothHCIPowerStateON) {
            return failure(@"powered-off", @"Bluetooth is off or unavailable. Turn it on in macOS, then retry; USB or configure-later remain available.");
        }
        Operation *operation = [Operation new];
        if ([command isEqual:@"status"] || [command isEqual:@"scan"]) {
            if ([command isEqual:@"scan"]) {
                NSDictionary *discovery = discoverBluetooth((id<PadcodeInquiry>)[IOBluetoothDeviceInquiry inquiryWithDelegate:nil], 20, &interrupted);
                output(discovery);
                return [discovery[@"ok"] boolValue] ? 0 : 1;
            }
            for (IOBluetoothDevice *device in [IOBluetoothDevice pairedDevices]) {
                if (device.addressString) operation.devices[device.addressString] = device;
            }
            NSMutableArray *devices = [NSMutableArray array];
            for (NSString *key in [[operation.devices allKeys] sortedArrayUsingSelector:@selector(compare:)]) [devices addObject:describe(operation.devices[key])];
            output(@{@"v": @1, @"ok": @YES, @"powered": @YES, @"devices": devices});
            return 0;
        }
        IOBluetoothDevice *device = [IOBluetoothDevice deviceWithAddressString:address];
        if (!device) return failure(@"device", @"Selected device is unavailable.");
        if ([command isEqual:@"pair"] && !device.isPaired) {
            IOBluetoothDevicePair *pair = [IOBluetoothDevicePair pairWithDevice:device];
            pair.delegate = operation;
            IOReturn result = [pair start];
            if (result != kIOReturnSuccess) return failure(@"pair", [NSString stringWithFormat:@"Pairing could not start (%d).", result]);
            BOOL finished = waitForOperation(operation, 40);
            pair.delegate = nil;
            if (!finished || operation.challenge || operation.error != kIOReturnSuccess) [pair stop];
            if (operation.challenge) return failure(@"authentication-challenge", @"This device requires PIN/passkey comparison, which this controller setup does not support yet. No challenge was approved.");
            if (!finished) return failure(interrupted ? @"cancelled" : @"timeout", @"Pairing timed out or was cancelled. Put the controller back in pairing mode and retry.");
            if (operation.error != kIOReturnSuccess || !device.isPaired) return failure(@"pair", [NSString stringWithFormat:@"Pairing did not complete (%d).", operation.error]);
        }
        if ([command isEqual:@"connect"] && !device.isConnected) {
            IOReturn result = [device openConnection:operation];
            if (result != kIOReturnSuccess) return failure(@"connect", [NSString stringWithFormat:@"Connection could not start (%d).", result]);
            if (!waitForOperation(operation, 20)) return failure(interrupted ? @"cancelled" : @"timeout", @"Connection timed out or was cancelled. Wake the controller and retry.");
            if (operation.error != kIOReturnSuccess || !device.isConnected) return failure(@"connect", [NSString stringWithFormat:@"Connection did not complete (%d).", operation.error]);
        }
        output(@{@"v": @1, @"ok": @YES, @"device": describe(device)});
        return 0;
    }
}
