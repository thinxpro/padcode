#import "permission.h"
#include <dlfcn.h>
#include <spawn.h>
#include <mach-o/dyld.h>
#include <unistd.h>
extern char **environ;

NSString *prepareBluetoothPermission(int argc, const char **argv, BOOL handedOff) {
    NSString *usage = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"NSBluetoothAlwaysUsageDescription"];
    if (![usage isKindOfClass:[NSString class]] || usage.length == 0)
        return @"Bluetooth usage metadata is missing. Reinstall the Padcode package.";
    // These macOS SPI symbols are optional. Never attempt Bluetooth if ownership
    // cannot be checked: TCC may otherwise abort a host such as Warp's child.
    pid_t (*responsible)(pid_t) = dlsym(RTLD_DEFAULT, "responsibility_get_pid_responsible_for_pid");
    int (*disclaim)(posix_spawnattr_t *, int) = dlsym(RTLD_DEFAULT, "responsibility_spawnattrs_setdisclaim");
    if (!responsible || !disclaim)
        return @"This macOS version cannot establish Padcode's Bluetooth permission identity. Configure Bluetooth later and report this compatibility error.";
    if (handedOff) {
        if (responsible(getpid()) != getpid())
            return @"macOS retained the terminal's Bluetooth permission identity. Try padcode config in Apple Terminal and report this compatibility error.";
        return nil;
    }
    uint32_t size = 0;
    _NSGetExecutablePath(NULL, &size);
    char *path = calloc(size, 1);
    if (!path || _NSGetExecutablePath(path, &size) != 0) {
        free(path); return @"Cannot locate the Bluetooth helper. Reinstall Padcode.";
    }
    char **arguments = calloc((size_t)argc + 2, sizeof(char *));
    if (!arguments) { free(path); return @"Cannot allocate Bluetooth launch arguments."; }
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
    return [NSString stringWithFormat:@"Cannot establish Bluetooth permission identity (%d). No Bluetooth access was attempted.", result];
}
