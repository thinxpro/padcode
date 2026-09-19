# Third-party notices

Padcode is MIT licensed. The native developer build links SDL 3.4.16 statically; SDL's license remains separate. SDL source is downloaded unchanged with a pinned SHA-256 during the developer build. Its source archive also includes applicable component-specific notices, which must be reviewed and preserved when packaging consumer binaries in P1.

## SDL 3.4.16 (zlib license)

Source: https://github.com/libsdl-org/SDL/releases/tag/release-3.4.16

```text
Copyright (C) 1997-2026 Sam Lantinga <slouken@libsdl.org>

This software is provided 'as-is', without any express or implied
warranty.  In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not
   claim that you wrote the original software. If you use this software
   in a product, an acknowledgment in the product documentation would be
   appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
```

Other build-only npm dependencies and their licenses are captured in `package-lock.json` and the installed packages; they are not bundled into the CLI runtime.

## node-pty 1.1.0 (MIT)

Source: https://github.com/microsoft/node-pty/tree/1.1.0

The current-platform npm artifact includes node-pty's Unix JavaScript runtime and native binary in `build/pty`. Its complete upstream license, including component copyright notices, is included at `build/pty/LICENSE`. The development build normalizes the macOS spawn-helper executable permission; the upstream runtime is otherwise unmodified. Padcode's own Node session host retains the PTY until output drain is acknowledged over a private lifecycle socket. node-addon-api 7.1.1 is a header dependency used in the native binary; its full MIT license is included at `build/pty/LICENSE-node-addon-api.md`.
