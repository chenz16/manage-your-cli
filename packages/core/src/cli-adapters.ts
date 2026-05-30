export interface CliAdapter {
  binary: string;
  label: string;
  interactiveArgs: string;
  pretrust: boolean;
}

export const CLI_ADAPTERS: Record<string, CliAdapter> = {
  claude: {
    binary: 'claude',
    label: 'Claude Code',
    interactiveArgs: '--dangerously-skip-permissions',
    pretrust: true,
  },
  codex: {
    binary: 'codex',
    label: 'Codex',
    interactiveArgs: '--dangerously-bypass-approvals-and-sandbox',
    pretrust: false,
  },
  gemini: {
    binary: 'gemini',
    label: 'Gemini CLI',
    interactiveArgs: '--yolo',
    pretrust: false,
  },
  qwen: {
    binary: 'qwen',
    label: 'Qwen Code',
    interactiveArgs: '--yolo',
    pretrust: false,
  },
};

export function getCliAdapter(binary: string): CliAdapter {
  return CLI_ADAPTERS[binary] ?? { binary, label: binary, interactiveArgs: '', pretrust: false };
}
