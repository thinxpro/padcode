#ifndef PADCODE_RECORDING_H
#define PADCODE_RECORDING_H
// What to do when the input device's configuration changes; free of AVFoundation so a harness can test it.
typedef enum { PadcodeConfigRestart, PadcodeConfigFail } PadcodeConfigAction;
enum { PadcodeMaxConfigRestarts = 3 };

// Before the first real audio nothing has been recorded, so the input chain is rebuilt with the new format.
// Once live, a format switch would splice the clip, so the recording fails instead.
static inline PadcodeConfigAction padcodeConfigChangeAction(int live, int restarts) {
    return !live && restarts < PadcodeMaxConfigRestarts ? PadcodeConfigRestart : PadcodeConfigFail;
}
#endif
