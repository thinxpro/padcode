// Fault injection is compiled only into this test executable, never the package.
#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <spawn.h>
#include <unistd.h>
#include <errno.h>
static const char *mode;
static int handoffs;
static pid_t fakeResponsible(pid_t pid) { return strcmp(mode, "foreign-owner") == 0 ? pid + 1 : pid; }
static int fakeDisclaim(posix_spawnattr_t *attributes, int value) {
    (void)attributes;
    if (value != 1) abort();
    return strcmp(mode, "disclaim-failure") == 0 ? EINVAL : 0;
}
static void *fakeLookup(void *handle, const char *name) {
    (void)handle;
    if (strcmp(mode, "missing-symbol") == 0) return NULL;
    return strstr(name, "get_pid") ? (void *)fakeResponsible : (void *)fakeDisclaim;
}
static int fakeSpawn(pid_t *pid, const char *path, const posix_spawn_file_actions_t *actions,
                     const posix_spawnattr_t *attributes, char *const arguments[], char *const environment[]) {
    (void)pid; (void)actions; (void)environment;
    short flags = 0; posix_spawnattr_getflags(attributes, &flags);
    if (!(flags & POSIX_SPAWN_SETEXEC) || strcmp(arguments[0], path) ||
        strcmp(arguments[1], "--permission-owner") || strcmp(arguments[2], "diagnose-permission") || arguments[3]) abort();
    ++handoffs;
    return EACCES;
}
#define dlsym fakeLookup
#define posix_spawn fakeSpawn
#include "../../native/permission.m"
int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc != 2) return 2;
        mode = argv[1];
        const char *args[] = {"helper", "diagnose-permission", NULL};
        BOOL internal = strcmp(mode, "foreign-owner") == 0 || strcmp(mode, "self-owner") == 0;
        NSString *error = prepareBluetoothPermission(2, args, internal);
        if (strcmp(mode, "self-owner") == 0) { if (error) return 3; puts("self-owner"); }
        else { if (!error) return 4; puts(error.UTF8String); }
        if (handoffs != (strcmp(mode, "spawn-failure") == 0 ? 1 : 0)) return 5;
        return 0;
    }
}
