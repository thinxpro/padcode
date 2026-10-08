#ifndef PADCODE_AUTHORIZATION_H
#define PADCODE_AUTHORIZATION_H
// Bluetooth consent decision, kept free of CoreBluetooth so a test harness can compile it without radio access.
typedef enum { PadcodeAuthUndetermined, PadcodeAuthRestricted, PadcodeAuthDenied, PadcodeAuthAllowed } PadcodeAuth;
typedef enum { PadcodeAuthContinue, PadcodeAuthRequest, PadcodeAuthPermission, PadcodeAuthPending, PadcodeAuthStopped } PadcodeAuthOutcome;

// `requested` is false before consent was asked for and true after the prompt wait ended.
static inline PadcodeAuthOutcome padcodeAuthorizationOutcome(PadcodeAuth state, int requested, int interrupted) {
    if (state == PadcodeAuthAllowed) return PadcodeAuthContinue;
    if (state == PadcodeAuthDenied || state == PadcodeAuthRestricted) return PadcodeAuthPermission;
    if (!requested) return PadcodeAuthRequest;
    return interrupted ? PadcodeAuthStopped : PadcodeAuthPending;
}
#endif
