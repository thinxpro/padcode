#!/bin/sh
# Fake afplay: records the requested path and plays for 0.4 seconds.
[ -n "$PADCODE_PLAY_LOG" ] && echo "$1" >> "$PADCODE_PLAY_LOG"
sleep 0.4
