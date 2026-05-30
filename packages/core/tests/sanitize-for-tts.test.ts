import { describe, it, expect } from 'vitest';
import { sanitizeForTts } from '../src/sanitize-for-tts.js';

describe('sanitizeForTts', () => {
  it('returns empty for empty input', () => {
    expect(sanitizeForTts('')).toBe('');
    expect(sanitizeForTts(' \n  \t  ')).toBe('');
  });

  it('keeps a plain Chinese sentence verbatim', () => {
    expect(sanitizeForTts('完成了发版任务。')).toBe('完成了发版任务。');
  });

  it('keeps a plain English sentence verbatim', () => {
    expect(sanitizeForTts('All checks passed.')).toBe('All checks passed.');
  });

  it('drops the leading emoji from a status line', () => {
    expect(sanitizeForTts('✅ 完成了 task 21 — 重启 desk'))
      .toBe('完成了 task 21 — 重启 desk');
  });

  it('drops fenced code blocks entirely', () => {
    const input = '看一下\n```ts\nconsole.log("hi");\n```\n再说。';
    const out = sanitizeForTts(input);
    expect(out).not.toMatch(/console/);
    expect(out).not.toMatch(/```/);
    expect(out).toMatch(/看一下/);
    expect(out).toMatch(/再说/);
  });

  it('drops bare http(s) URLs', () => {
    expect(sanitizeForTts('看 https://example.com/foo 这个'))
      .toBe('看 这个');
  });

  it('drops mailto: URLs', () => {
    expect(sanitizeForTts('email mailto:dev@example.com today'))
      .toBe('email today');
  });

  it('keeps the visible text of a markdown link, drops the URL', () => {
    expect(sanitizeForTts('参考 [文档](https://example.com/docs) 第三章'))
      .toBe('参考 文档 第三章');
  });

  it('drops markdown heading hashes', () => {
    expect(sanitizeForTts('## 第二章')).toBe('第二章');
    expect(sanitizeForTts('### Heading')).toBe('Heading');
  });

  it('drops bullet markers', () => {
    const input = '- 第一项\n- 第二项\n* 第三项';
    expect(sanitizeForTts(input)).toBe('第一项\n第二项\n第三项');
  });

  it('keeps bold/italic content, drops the markers', () => {
    expect(sanitizeForTts('this is **bold** here')).toBe('this is bold here');
    expect(sanitizeForTts('this is *italic* here')).toBe('this is italic here');
    expect(sanitizeForTts('this is ~~strike~~ here')).toBe('this is strike here');
  });

  it('drops arrow / dingbat / pictograph symbols', () => {
    expect(sanitizeForTts('转给 user → ★ ✓ ✗ ⏺').trim()).toBe('转给 user');
  });

  it('keeps Chinese sentence punctuation', () => {
    expect(sanitizeForTts('你好,这是一句话。再见!'))
      .toBe('你好,这是一句话。再见!');
  });

  it('drops file paths with two-or-more slashes', () => {
    expect(sanitizeForTts('路径 /home/user/project/foo.ts 改了'))
      .toBe('路径 改了');
    expect(sanitizeForTts('参见 ./apps/web/page.tsx 第 10 行'))
      .toBe('参见 第 10 行');
  });

  it('collapses runaway repeats of the same punctuation', () => {
    expect(sanitizeForTts('完成。。。再开。')).toBe('完成 再开。');
    expect(sanitizeForTts('====== title ======')).toBe('title');
  });

  it('strips orphan variation selectors after emoji removal', () => {
    expect(sanitizeForTts('⚠️ 错误,检查 .env 文件'))
      .toBe('错误,检查 .env 文件');
  });

  it('drops HTML entities', () => {
    expect(sanitizeForTts('a &amp; b &lt; c'))
      .toBe('a b c');
  });
});
