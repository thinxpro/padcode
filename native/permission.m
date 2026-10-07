#import "permission.h"
#include <dlfcn.h>
#include <spawn.h>
#include <mach-o/dyld.h>
#include <unistd.h>
extern char **environ;

NSString *preparePermissionOwner(int argc, const char **argv, BOOL handedOff, NSString *usageKey, NSString *label) {
    NSString *usage = [[NSBundle mainBundle] objectForInfoDictionaryKey:usageKey];
    if (![usage isKindOfClass:[NSString class]] || usage.length == 0)
        return [NSString stringWithFormat:@"%@ usage metadata is missing. Reinstall the Padcode package.", label];
    // These macOS SPI symbols are optional. Never attempt protected access if ownership
    // cannot be checked: TCC may otherwise abort a host such as Warp's child.
    pid_t (*responsible)(pid_t) = dlsym(RTLD_DEFAULT, "responsibility_get_pid_responsible_for_pid");
    int (*disclaim)(posix_spawnattr_t *, int) = dlsym(RTLD_DEFAULT, "responsibility_spawnattrs_setdisclaim");
    if (!responsible || !disclaim)
        return [NSString stringWithFormat:@"This macOS version cannot establish Padcode's %@ permission identity. Configure it later and report this compatibility error.", label];
    if (handedOff) {
        if (responsible(getpid()) != getpid())
            return [NSString stringWithFormat:@"macOS retained the terminal's %@ permission identity. Try padcode config in Apple Terminal and report this compatibility error.", label];
        return nil;
    }
    uint32_t size = 0;
    _NSGetExecutablePath(NULL, &size);
    char *path = calloc(size, 1);
    if (!path || _NSGetExecutablePath(path, &size) != 0) {
        free(path); return [NSString stringWithFormat:@"Cannot locate the %@ helper. Reinstall Padcode.", label];
    }
    char **arguments = calloc((size_t)argc + 2, sizeof(char *));
    if (!arguments) { free(path); return [NSString stringWithFormat:@"Cannot allocate %@ launch arguments.", label]; }
    arguments[0] = path;
    arguments[1] = "--permission-owner";
    for (int i = 1; i < argc; ++i) arguments[i + 1] = (char *)argv[i];
    posix_spawnattr_t attributes;
    int result = posix_spawnattr_init(&attributes);
    if (result == 0) {
        result = disclaim(&attributes, 1);
        // Replace this process: same PID, standard streams and cancellation target.
        if (result == 0) result = posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETEXEC);
        if (result == 0) result = posix_spawn(NULL, path, NULL, &attributes, arguments, environ);
        posix_spawnattr_destroy(&attributes);
    }
    free(arguments); free(path);
    return [NSString stringWithFormat:@"Cannot establish %@ permission identity (%d). No %@ access was attempted.", label, result, label];
}
NSString *prepareBluetoothPermission(int argc, const char **argv, BOOL handedOff) {
    return preparePermissionOwner(argc, argv, handedOff, @"NSBluetoothAlwaysUsageDescription", @"Bluetooth");
}
