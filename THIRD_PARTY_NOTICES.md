# Third-party notices

Padcode is MIT licensed. The `padcode-controller` helper links SDL 3.4.16 statically; SDL's license remains separate. SDL source is downloaded unchanged with a pinned SHA-256 during the build. The prebuilt `padcode-darwin` package ships these helpers and includes this file. The `padcode-bluetooth` and `padcode-audio` helpers link only macOS system frameworks.

SDL component review (2026-10-13, macOS universal build with the options in `native/CMakeLists.txt`): every SDL source file compiled into `padcode-controller` was checked for notices other than SDL's own. The components below are compiled in and their notices are reproduced here. Other compiled files by individual contributors (for example Valve's `controller_type.c`, the HIDAPI drivers for specific controllers, `SDL_rotate.c` from SDL_gfx) are under the same zlib license as SDL. `SDL_malloc.c` (dlmalloc by Doug Lea) and `SDL_strtokr.c` are public domain (CC0). `imKStoUCS.c` (X.Org/MIT notice) is compiled only for X11/Wayland and is empty in the macOS build.

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

## SDL components with their own notices

### HIDAPI (`src/hidapi`, macOS backend)

Source: https://github.com/libusb/hidapi — HIDAPI may be used under GPL-3.0, a BSD-style license or the original HIDAPI license at the user's choice; Padcode uses it under the BSD-style license.

```text
Copyright (c) 2010, Alan Ott, Signal 11 Software
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of Signal 11 Software nor the names of its
      contributors may be used to endorse or promote products derived from
      this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

### libm (`src/libm`, derived from Sun fdlibm)

Source: SDL 3.4.16 `src/libm`

```text
Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.

Developed at SunPro, a Sun Microsystems, Inc. business.
Permission to use, copy, modify, and distribute this
software is freely granted, provided that this notice
is preserved.
```

### yuv2rgb (`src/video/yuv2rgb`)

Source: https://github.com/descampsa/yuv2rgb

```text
Copyright (c) 2016, Adrien Descamps
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of yuv2rgb nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### qsort (`src/stdlib/SDL_qsort.c`)

Source: SDL 3.4.16 `src/stdlib/SDL_qsort.c`

```text
Copyright (c) 1998-2021 Gareth McCaughan

This software is provided 'as-is', without any express or implied
warranty. In no event will the authors be held liable for any
damages arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented;
   you must not claim that you wrote the original software.
   If you use this software in a product, an acknowledgment
   in the product documentation would be appreciated but
   is not required.

2. Altered source versions must be plainly marked as such,
   and must not be misrepresented as being the original software.

3. This notice may not be removed or altered from any source
   distribution.
```

Other build-only npm dependencies and their licenses are captured in `package-lock.json` and the installed packages; they are not bundled into the CLI runtime.

## node-pty 1.1.0 (MIT)

Source: https://github.com/microsoft/node-pty/tree/1.1.0

The `padcode-darwin` package includes node-pty's Unix JavaScript runtime and its upstream darwin-arm64 and darwin-x64 prebuilt binaries in `pty/` (`build/pty` in a development checkout). Its complete upstream license, including component copyright notices, is included at `pty/LICENSE`. The development build normalizes the macOS spawn-helper executable permission; the upstream runtime is otherwise unmodified. Padcode's own Node session host retains the PTY until output drain is acknowledged over a private lifecycle socket. node-addon-api 7.1.1 is a header dependency used in the native binary; its full MIT license is included at `pty/LICENSE-node-addon-api.md`.
