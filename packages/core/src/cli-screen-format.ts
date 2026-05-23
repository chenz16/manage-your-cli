export interface CliScreenFormatter {
  push(chunk: string): string;
  current(): string;
  isBusy(): boolean;
}

export interface CliScreenFormatterOptions {
  sentPrompt?: string;
  maxBufferChars?: number;
}

const DEFAULT_MAX_BUFFER_CHARS = 96 * 1024;
const HARD_BUSY_RE = /esc to interrupt/i;

export function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[PX^_].*?\x1b\\/gs, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function promptTail(sentPrompt?: string): string | null {
  const tail = sentPrompt?.split('\n').map((line) => line.trim()).filter(Boolean).at(-1);
  return tail || null;
}

function isSeparator(line: string): boolean {
  return /^\s*[─━]{6,}\s*$/.test(line)
    || (/^[╭╮╰╯│─━┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬\s]+$/.test(line) && /[╭╮╰╯│─━┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬]/.test(line));
}

function isInputBox(line: string): boolean {
  return /^\s*[>❯⏵]\s?/.test(line)
    || /^\s*>\s*$/.test(line)
    || /(?:^\s*|\s)(?:Write your prompt|Type your message|Send a message)/i.test(line);
}

function isStatus(line: string): boolean {
  return /^\s*[✻✶✳*·⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s/.test(line)
    || /esc to interrupt|tokens used|bypass permissions|\? for shortcuts|focus-events|focus tracking|cogitated for|tool use|running tool|read\(|write\(|edit\(|bash\(|glob\(|grep\(/i.test(line)
    || /^\s*(thinking|running)\b/i.test(line);
}

function stripAnswerChrome(line: string): string {
  return line
    .replace(/^\s*[●⏺⎿]\s?/, '')
    .replace(/^\s*[╎│]\s?/, '')
    .replace(/[ \t]+$/g, '');
}

function cleanScreen(buffer: string, sentPrompt?: string): string {
  const text = stripAnsi(buffer);
  const tail = promptTail(sentPrompt);
  const start = tail ? text.lastIndexOf(tail) : -1;
  if (tail && start < 0) return '';
  const after = start >= 0 ? text.slice(start + tail!.length) : text;
  const out: string[] = [];

  for (const rawLine of after.split('\n')) {
    const line = rawLine.replace(/\u00a0/g, ' ');
    if (out.length > 0 && (isSeparator(line) || isInputBox(line))) break;
    if (isSeparator(line) || isInputBox(line) || isStatus(line)) continue;
    if (!line.trim()) {
      if (out.length) out.push('');
      continue;
    }
    out.push(stripAnswerChrome(line));
  }

  while (out[0] === '') out.shift();
  while (out.at(-1) === '') out.pop();
  return out.join('\n').trim();
}

export function createCliScreenFormatter(options: CliScreenFormatterOptions = {}): CliScreenFormatter {
  const maxBufferChars = options.maxBufferChars ?? DEFAULT_MAX_BUFFER_CHARS;
  let buffer = '';
  let latest = '';

  return {
    push(chunk: string): string {
      buffer = (buffer + chunk).slice(-maxBufferChars);
      latest = cleanScreen(buffer, options.sentPrompt);
      return latest;
    },
    current(): string {
      return latest;
    },
    isBusy(): boolean {
      return HARD_BUSY_RE.test(stripAnsi(buffer));
    },
  };
}
