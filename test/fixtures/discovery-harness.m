#import "../../native/discovery.h"
@interface FakeDevice : NSObject
@property(copy) NSString *addressString;
@property(copy) NSString *name;
- (BOOL)isPaired;
- (BOOL)isConnected;
@end
@implementation FakeDevice
- (BOOL)isPaired { return NO; }
- (BOOL)isConnected { return NO; }
@end
@interface FakeInquiry : NSObject <PadcodeInquiry>
@property(assign) id delegate;
@property uint8_t inquiryLength;
@property BOOL updateNewDeviceNames;
@property(copy) NSString *mode;
@property BOOL stopped;
@property BOOL began;
@property(strong) NSArray *results;
@property volatile sig_atomic_t *cancelled;
@end
@implementation FakeInquiry
- (IOReturn)start {
    self.began = YES;
    if (self.updateNewDeviceNames || self.inquiryLength != 8) abort();
    if ([self.mode isEqual:@"start-error"]) return kIOReturnError;
    [self performSelector:@selector(deliver) withObject:nil afterDelay:0.001];
    return kIOReturnSuccess;
}
- (void)deliver {
    id delegate = self.delegate;
    if (!delegate) return;
    if ([self.mode isEqual:@"not-started"]) return;
    [delegate deviceInquiryStarted:(id)self];
    if ([self.mode isEqual:@"cancel"]) { *self.cancelled = 1; return; }
    BOOL hasDevice = [@[@"complete", @"partial", @"stored-only", @"aborted", @"error"] containsObject:self.mode];
    if (hasDevice) {
        FakeDevice *device = [FakeDevice new]; device.addressString = @"00:11:22:33:44:55";
        device.name = [self.mode isEqual:@"complete"] ? @"Wireless Controller" : nil;
        self.results = @[device];
        if (![self.mode isEqual:@"stored-only"]) {
            [delegate deviceInquiryDeviceFound:(id)self device:(id)device];
            [delegate deviceInquiryDeviceFound:(id)self device:(id)device];
        }
    }
    if ([@[@"complete", @"empty", @"aborted", @"error", @"empty-error"] containsObject:self.mode])
        [delegate deviceInquiryComplete:(id)self error:([self.mode isEqual:@"error"] || [self.mode isEqual:@"empty-error"]) ? kIOReturnError : kIOReturnSuccess aborted:[self.mode isEqual:@"aborted"]];
}
- (IOReturn)stop {
    if (self.delegate != nil) abort();
    self.stopped = YES;
    [NSObject cancelPreviousPerformRequestsWithTarget:self];
    return kIOReturnSuccess;
}
- (NSArray *)foundDevices { if (!self.stopped) abort(); return self.results ?: @[]; }
@end
int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc != 2) return 2;
        FakeInquiry *inquiry = [FakeInquiry new]; inquiry.mode = @(argv[1]);
        volatile sig_atomic_t cancelled = [inquiry.mode isEqual:@"pre-cancel"] ? 1 : 0;
        inquiry.cancelled = &cancelled;
        NSDictionary *result = discoverBluetooth([inquiry.mode isEqual:@"unavailable"] ? nil : inquiry, 0.05, &cancelled);
        if (![inquiry.mode isEqual:@"unavailable"] && (!inquiry.stopped || inquiry.delegate)) return 3;
        if ([inquiry.mode isEqual:@"pre-cancel"] && inquiry.began) return 4;
        NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
        fwrite(json.bytes, 1, json.length, stdout); puts("");
        return 0;
    }
}
