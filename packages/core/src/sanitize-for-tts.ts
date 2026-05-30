/**
 * sanitize-for-tts — strip the noise that TTS engines mispronounce or read
 * literally before handing text to edge-tts / native TTS / Web Speech.
 *
 * Owner has repeatedly flagged: "TTS 把特殊字符 + 信号符号也读出来,需要过滤
 * 只保留文字". Previous mobile-side attempt was too narrow (markdown only)
 * and the desk endpoint passed text through untouched, so anything posted
 * server-side bypassed the filter. This module lives in @holon/core so both
 * sides share one implementation.
 *
 * What survives:
 *   - CJK ideographs, Latin/Cyrillic/Arabic/Devanagari/Hangul/Kana letters
 *   - digits (a TTS engine reads them aloud fine)
 *   - "natural" sentence punctuation: . , : ; ! ? 。 ， ： ； ！ ？ 、 …
 *   - quotes (straight + curly) + parentheses (read as breath)
 *   - hyphen/dash between letters (compound words)
 *
 * What gets dropped:
 *   - all fenced code blocks (the language tag + every char would be droned)
 *   - inline-code backticks (keep the inside text)
 *   - markdown link `[text](url)` → keep "text", drop the URL
 *   - bare URLs http(s):// + www.
 *   - markdown heading `#`, blockquote `>`, bullet `- * + •` at line start
 *   - bold/italic/strike markers `* _ ~` around words (keep the word)
 *   - emojis + ALL Unicode pictographs / dingbats / symbol blocks
 *   - arrow / math / box-drawing / private-use symbol blocks
 *   - stray symbol clusters: # @ ^ | < > { } [ ] \ ` ★ ☆ ✓ ✗ … etc.
 *   - file-system-style paths `./foo`, `/path/to/x` (drop entirely)
 *   - HTML entities (&amp; → &)
 *   - long runs of the same symbol (……, ----) collapsed to ' '
 */
export function sanitizeForTts(raw: string): string {
  if (!raw) return '';
  let s = raw;

  // 1. Fenced code blocks first — most noise per character.
  s = s.replace(/```[\s\S]*?```/g, ' ');

  // 2. HTML entities → their characters (so &amp;->& which we then drop).
  s = s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);/g, ' ');

  // 3. Markdown link text [text](url) → text.
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 4. Bare URLs (http/https/www / mailto).
  s = s.replace(/\b(?:https?|mailto|file):\S+/gi, ' ');
  s = s.replace(/\bwww\.\S+/g, ' ');

  // 5. File-system paths (drop wholesale — they read as "slash foo slash bar
  //    dot ts" which is useless aloud and dominates summary output).
  s = s.replace(/(?:^|\s)(?:\.{1,2}\/|\/)?[\w@-]+(?:\/[\w.@-]+){2,}(?=\s|$)/g, ' ');

  // 6. Inline `code` → drop backticks, keep text.
  s = s.replace(/`([^`]+)`/g, '$1');

  // 7. Heading hashes / blockquote / bullets / numbered list markers at line start.
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  s = s.replace(/^\s*>+\s?/gm, '');
  s = s.replace(/^\s*[-*+•]\s+/gm, '');
  s = s.replace(/^\s*\d+\.\s+/gm, '');

  // 8. Bold/italic/strike markers — keep word inside.
  s = s.replace(/(\*{1,3}|_{1,3}|~{1,2})(\S[\s\S]*?\S)\1/g, '$2');

  // 9. Emojis + all pictographs / symbols (covers ✓ ✗ ★ → ← ⏺ etc.).
  s = s.replace(/\p{Extended_Pictographic}/gu, ' ');
  // Other symbol categories that TTS engines often vocalize literally.
  // \p{S} = all symbol categories (math/currency/modifier/other).
  s = s.replace(/\p{S}/gu, ' ');
  // Variation selectors + zero-width joiners often orphan after the
  // pictograph in front of them gets stripped (the joining sequence ❤️
  // leaves a stray VS-16). \p{M} = combining marks.
  s = s.replace(/[​-‏︀-️⁠-⁩]/g, '');

  // 10. Specific punctuation that's almost never useful aloud.
  //     Keep: . , : ; ! ? quotes parens 。，：；！？、… — these breathe.
  //     Strip everything else (incl. middle-dot · which engines read
  //     literally as "middle dot" or pause oddly).
  s = s.replace(/[#@^|<>{}[\]\\`~_*=+\\/·]/g, ' ');

  // 11. Long runs of the same non-letter character (≥3) → single space.
  s = s.replace(/([^\p{L}\p{N}\s])\1{2,}/gu, ' ');

  // 12. Collapse whitespace.
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\s*\n\s*/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}
