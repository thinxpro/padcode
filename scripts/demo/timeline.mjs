// The scripted demo storyline. Each step optionally waits for a screen or Agent state, holds so viewers
// can read, shows a caption in the HUD, then sends one virtual controller action.
export const sentence = 'add a dark mode toggle to the settings page';
export const commands = ['/test', '/review'];
export const hudLabel = 'VIRTUAL CONTROLLER / scripted demo';

// PlayStation names, matching the virtual controller's family.
export const buttonNames = {
  south: 'X', east: 'O', west: 'SQUARE', north: 'TRIANGLE', start: 'OPTIONS', back: 'SHARE',
  dpad_up: 'D-PAD UP', dpad_down: 'D-PAD DOWN', dpad_left: 'D-PAD LEFT', dpad_right: 'D-PAD RIGHT',
  left_shoulder: 'L1', right_shoulder: 'R1', touchpad: 'TOUCHPAD', l2: 'L2 HOLD',
};

export const steps = [
  { name: 'hub', until: /PLAYER HUB/, hold: 1800, caption: 'Player Hub: every screen works from the controller', press: 'dpad_down' },
  { hold: 550, press: 'dpad_down' },
  { hold: 550, press: 'dpad_up' },
  { hold: 550, press: 'dpad_up' },
  { name: 'select', hold: 700, caption: 'X selects Start agent session', press: 'south' },
  { name: 'confirm', until: /MISSION START/, hold: 2200, caption: 'Padcode shows the exact command and project before anything runs', press: 'dpad_up' },
  { hold: 700, press: 'south' },
  { name: 'session', agent: state => state.phase === 'ready', until: /demo-agent/, hold: 1800, caption: 'Your Agent runs unchanged; the controls pane sits below it' },
  { name: 'dictate', hold: 300, caption: 'Hold L2 to dictate; release to transcribe on this Mac', trigger: 1700 },
  { name: 'inserted', agent: state => state.input === sentence, hold: 1700, caption: 'The text is typed into the Agent, never sent. X sends it', press: 'south' },
  { name: 'approval', agent: state => state.phase === 'approval', hold: 1600, caption: "D-pad and X answer the Agent's own prompts", press: 'dpad_down' },
  { hold: 600, press: 'dpad_up' },
  { hold: 600, press: 'south' },
  { name: 'answered', agent: state => state.phase === 'ready' && state.answers.length === 1, hold: 1600, caption: 'SHARE opens quick commands', press: 'back' },
  { name: 'commands', until: /QUICK COMMANDS/, hold: 900, press: 'dpad_down' },
  { hold: 500, press: 'dpad_down' },
  { hold: 700, caption: 'X types the command into the Agent', press: 'south' },
  { name: 'typed', agent: state => state.input === commands[0], hold: 1100, caption: 'Typed, not sent: X runs it', press: 'south' },
  { name: 'tested', agent: state => state.phase === 'ready' && state.submitted.length === 2, hold: 1600, caption: 'OPTIONS opens the controls menu', press: 'start' },
  { name: 'controls', until: /PADCODE CONTROLS/, hold: 1300, press: 'dpad_up' },
  { hold: 700, caption: 'End the session from the controller', press: 'south' },
  { name: 'end', until: /END SESSION\?/, hold: 800, press: 'dpad_down' },
  { hold: 600, press: 'south' },
  { name: 'over', until: /SESSION OVER/, hold: 1800, caption: 'Back at the Player Hub. O exits', press: 'east' },
  { name: 'done', hold: 0, caption: 'DEMO COMPLETE / npm install -g padcode-cli' },
];
