#import <Foundation/Foundation.h>
#import <IOBluetooth/IOBluetooth.h>
#include <signal.h>

// A narrow seam for testing the real lifecycle without opening the radio.
@protocol PadcodeInquiry <NSObject>
@property(assign) id delegate;
@property uint8_t inquiryLength;
@property BOOL updateNewDeviceNames;
- (IOReturn)start;
- (IOReturn)stop;
- (NSArray *)foundDevices;
@end
NSDictionary *discoverBluetooth(id<PadcodeInquiry> inquiry, NSTimeInterval timeout,
                               volatile sig_atomic_t *cancelled);
