import { describe, expect, it } from 'vitest';
import { createCliScreenFormatter } from '../src/cli-screen-format.js';

describe('cli-screen-format', () => {
  it('keeps only the conversational reply from a raw CLI screen stream', () => {
    const formatter = createCliScreenFormatter({ sentPrompt: 'please summarize this' });
    const clean = formatter.push([
      '\u001b[2J╭────────────────────────╮',
      '│ > please summarize this │',
      '╰────────────────────────╯',
      '⠋ Running tool read_memory(scope: "index")',
      '● Here is the concise answer.',
      '  It has a second line.',
      '✻ Cogitated for 1s',
      '──────────────────────────',
      '❯ ',
    ].join('\n'));

    expect(clean).toBe('Here is the concise answer.\n  It has a second line.');
  });
});
