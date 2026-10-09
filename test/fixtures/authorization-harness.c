// Prints the Bluetooth consent outcome for every state; compiled by test/bluetooth.test.mjs (no radio access).
#include <stdio.h>
#include "../../native/authorization.h"
int main(void) {
    const char *states[] = { "undetermined", "restricted", "denied", "allowed" };
    const char *outcomes[] = { "continue", "request", "permission", "pending", "stopped" };
    for (int state = 0; state < 4; state++) for (int requested = 0; requested < 2; requested++) for (int interrupted = 0; interrupted < 2; interrupted++)
        printf("%s requested=%d interrupted=%d -> %s\n", states[state], requested, interrupted, outcomes[padcodeAuthorizationOutcome((PadcodeAuth)state, requested, interrupted)]);
    return 0;
}
