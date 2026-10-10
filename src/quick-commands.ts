// Quick commands are typed into the Agent as keystrokes and never followed by Enter: the Agent's own
// picker appears and the player confirms. Lists follow Claude Code 2.1 and Codex 0.161 (docs/stages/quick-commands.md).
export type AgentKind = 'claude' | 'codex' | 'other';
export interface QuickCommand { label: string; keys: string }
export const maxCustom = 8, maxCustomLength = 60;

export function agentKind(command: string): AgentKind {
  const name = (command.split(/[\\/]/).pop() ?? '').replace(/\.(exe|cmd)$/i, '').toLowerCase();
  return name === 'claude' ? 'claude' : name === 'codex' ? 'codex' : 'other';
}
// A custom entry is one printable line that starts a slash command; its UTF-8 bytes fit one key message.
export const validCustom = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 2 && Buffer.byteLength(value) <= maxCustomLength && value.startsWith('/') && !/[\x00-\x1f\x7f-\x9f]/u.test(value);

const sigils: Record<AgentKind, [string, string][]> = {
  claude: [['/', 'Browse all commands'], ['@', 'Mention a file'], ['!', 'Shell mode']],
  codex: [['/', 'Browse all commands'], ['@', 'Mention a file'], ['$', 'Mention a skill']],
  other: [['/', 'Browse all commands'], ['@', 'Mention a file']],
};
const builtins: Record<AgentKind, [string, string][]> = {
  claude: [
    ['/clear', 'New conversation'], ['/compact', 'Summarise to free context'], ['/model', 'Pick model and effort'], ['/resume', 'Resume a session'],
    ['/rewind', 'Rewind to a checkpoint'], ['/plan', 'Plan mode'], ['/context', 'Context usage'], ['/diff', 'Review changes'], ['/usage', 'Plan usage'],
  ],
  codex: [
    ['/clear', 'Clear screen, new chat'], ['/compact', 'Summarise to free context'], ['/model', 'Pick model and effort'], ['/resume', 'Resume a session'],
    ['/plan', 'Plan mode'], ['/diff', 'Review changes'], ['/status', 'Session status'], ['/review', 'Review my changes'], ['/fork', 'Fork this chat'],
  ],
  other: [],
};
const row = (keys: string, text: string) => `${keys.padEnd(10)} ${text}`;
export function quickCommands(kind: AgentKind, custom: readonly string[] = []): QuickCommand[] {
  return [
    ...sigils[kind].map(([keys, text]) => ({ keys, label: row(keys, text) })),
    ...builtins[kind].map(([keys, text]) => ({ keys, label: row(keys, text) })),
    ...custom.filter(validCustom).slice(0, maxCustom).map(keys => ({ keys, label: keys.length < 10 ? row(keys, 'Custom') : keys })),
  ];
}
