#include <SDL3/SDL.h>
#include <array>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <unistd.h>

static volatile std::sig_atomic_t stopping = 0;
static void stop(int) { stopping = 1; }
static unsigned long long sequence = 0;
static const char *buttons[] = {"south", "east", "west", "north", "back", "guide", "start", "left_stick", "right_stick", "left_shoulder", "right_shoulder", "dpad_up", "dpad_down", "dpad_left", "dpad_right", "misc1", "right_paddle1", "left_paddle1", "right_paddle2", "left_paddle2", "touchpad", "misc2", "misc3", "misc4", "misc5", "misc6"};
static const char *axes[] = {"leftx", "lefty", "rightx", "righty", "left_trigger", "right_trigger"};
static_assert(std::size(buttons) == SDL_GAMEPAD_BUTTON_COUNT);
static_assert(std::size(axes) == SDL_GAMEPAD_AXIS_COUNT);

static std::string quote(const char *value) {
    std::string result = "\"";
    for (const unsigned char c : std::string(value ? value : "Unknown controller")) {
        if (c == '"' || c == '\\') { result += '\\'; result += static_cast<char>(c); }
        else if (c < 32) { char escaped[7]; std::snprintf(escaped, sizeof escaped, "\\u%04x", c); result += escaped; }
        else result += static_cast<char>(c);
    }
    return result + '"';
}
static void emit(const std::string &fields) {
    if (std::printf("{\"v\":1,\"seq\":%llu,\"time\":%llu,%s}\n", sequence++, static_cast<unsigned long long>(SDL_GetTicks()), fields.c_str()) < 0 || std::fflush(stdout) != 0) stopping = 1;
}
static std::string deviceField(SDL_JoystickID id) { return "\"device\":" + std::to_string(id); }
struct Pad { SDL_Gamepad *handle; std::array<int, SDL_GAMEPAD_AXIS_COUNT> pending; };

int main(int argc, char **argv) {
    const bool synthetic = argc == 2 && std::strcmp(argv[1], "--virtual-test") == 0;
    if (argc > 1 && !synthetic) { std::fprintf(stderr, "Usage: padcode-controller [--virtual-test]\n"); return 2; }
    std::signal(SIGINT, stop); std::signal(SIGTERM, stop);
    const pid_t parent = getppid();
    SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, "1");
    if (!SDL_Init(SDL_INIT_GAMEPAD)) { std::fprintf(stderr, "SDL init failed: %s\n", SDL_GetError()); return 1; }
    const int version = SDL_GetVersion();
    emit(std::string("\"type\":\"ready\",\"source\":\"") + (synthetic ? "virtual" : "hardware") + "\",\"sdl\":\"" + std::to_string(SDL_VERSIONNUM_MAJOR(version)) + "." + std::to_string(SDL_VERSIONNUM_MINOR(version)) + "." + std::to_string(SDL_VERSIONNUM_MICRO(version)) + "\"");
    SDL_JoystickID virtualId = 0;
    SDL_Joystick *virtualPad = nullptr;
    if (synthetic) {
        SDL_VirtualJoystickDesc desc;
        SDL_INIT_INTERFACE(&desc);
        desc.type = SDL_JOYSTICK_TYPE_GAMEPAD;
        desc.naxes = SDL_GAMEPAD_AXIS_COUNT; desc.nbuttons = SDL_GAMEPAD_BUTTON_COUNT;
        desc.axis_mask = (1u << SDL_GAMEPAD_AXIS_COUNT) - 1;
        desc.button_mask = (1u << SDL_GAMEPAD_BUTTON_COUNT) - 1;
        desc.name = "Padcode \"virtual\" \\ test\ncontroller";
        virtualId = SDL_AttachVirtualJoystick(&desc);
        virtualPad = virtualId ? SDL_OpenJoystick(virtualId) : nullptr;
        if (!virtualPad) { std::fprintf(stderr, "Virtual device failed: %s\n", SDL_GetError()); SDL_Quit(); return 1; }
    }
    std::map<SDL_JoystickID, Pad> pads;
    const Uint64 start = SDL_GetTicks();
    int step = 0;
    int result = 0;
    while (!stopping && getppid() == parent) {
        const Uint64 elapsed = SDL_GetTicks() - start;
        if (synthetic && elapsed >= static_cast<Uint64>((step + 1) * 80)) {
            bool ok = true;
            if (step == 0) ok = SDL_SetJoystickVirtualButton(virtualPad, SDL_GAMEPAD_BUTTON_SOUTH, true);
            if (step == 1) ok = SDL_SetJoystickVirtualAxis(virtualPad, SDL_GAMEPAD_AXIS_LEFTX, 24576);
            if (step == 2) ok = SDL_SetJoystickVirtualButton(virtualPad, SDL_GAMEPAD_BUTTON_SOUTH, false);
            if (step == 3) ok = SDL_SetJoystickVirtualAxis(virtualPad, SDL_GAMEPAD_AXIS_LEFTX, 0);
            if (step == 4) { SDL_CloseJoystick(virtualPad); virtualPad = nullptr; ok = SDL_DetachVirtualJoystick(virtualId); }
            if (step == 5) break;
            if (!ok) { std::fprintf(stderr, "Virtual input failed: %s\n", SDL_GetError()); result = 1; break; }
            step++;
        }
        SDL_Event event;
        while (SDL_PollEvent(&event)) {
            if (event.type == SDL_EVENT_GAMEPAD_ADDED) {
                const auto id = event.gdevice.which;
                if ((synthetic && id != virtualId) || pads.count(id)) continue;
                SDL_Gamepad *handle = SDL_OpenGamepad(id);
                if (!handle) { std::fprintf(stderr, "Cannot open gamepad: %s\n", SDL_GetError()); continue; }
                Pad pad{handle, {}}; pad.pending.fill(65536); pads.emplace(id, pad);
                const auto connection = SDL_GetGamepadConnectionState(handle);
                const char *transport = connection == SDL_JOYSTICK_CONNECTION_WIRELESS ? "wireless" : connection == SDL_JOYSTICK_CONNECTION_WIRED ? "wired" : "unknown";
                const char *serial = SDL_GetGamepadSerial(handle);
                emit("\"type\":\"connected\"," + deviceField(id) + ",\"name\":" + quote(SDL_GetGamepadName(handle)) + ",\"connection\":" + quote(transport) + (serial ? ",\"serial\":" + quote(serial) : ""));
            } else if (event.type == SDL_EVENT_GAMEPAD_REMOVED) {
                const auto id = event.gdevice.which;
                const auto found = pads.find(id);
                if (found == pads.end()) continue;
                SDL_CloseGamepad(found->second.handle); pads.erase(found);
                emit("\"type\":\"disconnected\"," + deviceField(id));
            } else if (event.type == SDL_EVENT_GAMEPAD_BUTTON_DOWN || event.type == SDL_EVENT_GAMEPAD_BUTTON_UP) {
                if (!pads.count(event.gbutton.which) || event.gbutton.button >= SDL_GAMEPAD_BUTTON_COUNT) continue;
                emit("\"type\":\"button\"," + deviceField(event.gbutton.which) + ",\"button\":" + quote(buttons[event.gbutton.button]) + ",\"down\":" + (event.gbutton.down ? "true" : "false"));
            } else if (event.type == SDL_EVENT_GAMEPAD_AXIS_MOTION) {
                const auto found = pads.find(event.gaxis.which);
                if (found != pads.end() && event.gaxis.axis < SDL_GAMEPAD_AXIS_COUNT) found->second.pending[event.gaxis.axis] = event.gaxis.value;
            }
        }
        // Coalesce axis values within a poll cycle; button/release/removal events stay ordered.
        for (auto &[id, pad] : pads) for (int a = 0; a < SDL_GAMEPAD_AXIS_COUNT; a++) {
            if (pad.pending[a] == 65536) continue;
            emit("\"type\":\"axis\"," + deviceField(id) + ",\"axis\":" + quote(axes[a]) + ",\"value\":" + std::to_string(pad.pending[a]));
            pad.pending[a] = 65536;
        }
        SDL_Delay(8);
    }
    for (auto &[id, pad] : pads) { (void)id; SDL_CloseGamepad(pad.handle); }
    if (virtualPad) { SDL_CloseJoystick(virtualPad); SDL_DetachVirtualJoystick(virtualId); }
    SDL_Quit();
    return result;
}
