#import <Foundation/Foundation.h>
// nil means the current process owns its usage description and may request consent.
NSString *preparePermissionOwner(int argc, const char **argv, BOOL handedOff, NSString *usageKey, NSString *label);
NSString *prepareBluetoothPermission(int argc, const char **argv, BOOL handedOff);
