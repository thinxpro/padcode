// Prints the configuration-change decision for each state; compiled by test/native.test.mjs (no audio device).
#include <stdio.h>
#include "../../native/recording.h"
int main(void) {
    for (int live = 0; live < 2; live++) for (int restarts = 0; restarts <= 4; restarts++)
        printf("live=%d restarts=%d -> %s\n", live, restarts, padcodeConfigChangeAction(live, restarts) == PadcodeConfigRestart ? "restart" : "fail");
    return 0;
}
