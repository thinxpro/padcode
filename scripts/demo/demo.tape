# Scripted README demo. Regenerate with: npm run demo:record
# The input is a virtual controller and the Agent is a stand-in; see docs/demo.md.
Output docs/media/demo.gif
Output docs/media/demo.mp4

Set Shell "bash"
Set FontSize 16
Set Width 1180
Set Height 780
Set Padding 18
Set Framerate 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 0
Set CursorBlink false

# VHS Wait only reads the normal screen, so the shell prints a marker once the demo has exited.
Hide
Type "clear; node scripts/demo/run.mjs; clear; printf 'demo-%s\n' finished" Enter
Sleep 400ms
Show
Wait+Screen@180s /demo-finished/
Hide
