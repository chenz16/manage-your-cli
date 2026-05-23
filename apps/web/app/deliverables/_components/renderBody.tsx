'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * Render a deliverable body with minimal markdown-ish affordances:
 *
 *   - http(s)://... and file://... URLs become clickable <a>.
 *   - Markdown-style [label](url) becomes <a>.
 *   - Absolute filesystem paths (/home/..., /Users/...) and common
 *     repo-relative paths (apps/, packages/, src/, bugs/, docs/) become
 *     clickable <code> chips that copy themselves to the clipboard on
 *     click (browsers block file:// from http pages, so copy-to-clip is
 *     the most useful affordance).
 *   - **bold** and `inline code` get the standard rendering.
 *   - Newlines preserved.
 *
 * Per user 2026-05-17 (bug-20260517-024202): "能把调查结果在是专员
 * 这个角色中弄成一个网页链接么". Smallest-viable scope per the
 * updated AGENT_BRIEF: UI-side renderer only, no worker change.
 */

type Token =
  | { kind: 'text'; text: string }
  | { kind: 'link'; href: string; label: string }
  | { kind: 'path'; path: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string };

const URL_RE = /\bhttps?:\/\/[^\s<>)]+/g;
const FILE_URL_RE = /\bfile:\/\/[^\s<>)]+/g;
const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
// Absolute or workspace-relative paths. Trim trailing punctuation when matched at sentence end.
const PATH_RE = /(?:^|(?<=[\s(]))(?:\/(?:home|Users|tmp|var|opt|etc)\/[^\s<>)]+|(?:apps|packages|src|bugs|docs|iterations|agents)\/[^\s<>)]+)/g;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const CODE_RE = /`([^`]+)`/g;

interface Match { start: number; end: number; token: Token }

/** Run a regex across `s` and produce non-overlapping match descriptors. */
function collect(s: string, re: RegExp, make: (m: RegExpExecArray) => Token): Match[] {
  const out: Match[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, token: make(m) });
  }
  return out;
}

/** Tokenize one line into [text/link/path/bold/code] segments by running
 *  all recognizer regexes and resolving overlaps with first-wins-by-start. */
function tokenizeLine(line: string): Token[] {
  const matches: Match[] = [
    ...collect(line, MD_LINK_RE, (m) => ({ kind: 'link', href: m[2]!, label: m[1]! })),
    ...collect(line, FILE_URL_RE, (m) => ({ kind: 'link', href: m[0], label: m[0] })),
    ...collect(line, URL_RE, (m) => ({ kind: 'link', href: m[0], label: m[0] })),
    ...collect(line, PATH_RE, (m) => ({ kind: 'path', path: stripTrailingPunct(m[0]) })),
    ...collect(line, BOLD_RE, (m) => ({ kind: 'bold', text: m[1]! })),
    ...collect(line, CODE_RE, (m) => ({ kind: 'code', text: m[1]! })),
  ];
  // Resolve overlaps: sort by start, drop any that overlap a previously-
  // kept match. URLs win over paths when they overlap (URL_RE comes
  // before PATH_RE in the array, so given equal start it lands first).
  matches.sort((a, b) => a.start - b.start || a.end - b.end);
  const kept: Match[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) continue;
    kept.push(m);
    cursor = m.end;
  }
  // Stitch tokens + plaintext gaps.
  const out: Token[] = [];
  let pos = 0;
  for (const m of kept) {
    if (m.start > pos) out.push({ kind: 'text', text: line.slice(pos, m.start) });
    out.push(m.token);
    // Adjust path-token end if we stripped trailing punctuation.
    pos = m.token.kind === 'path' ? m.start + m.token.path.length : m.end;
  }
  if (pos < line.length) out.push({ kind: 'text', text: line.slice(pos) });
  return out;
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[.,;:!?)\]]+$/, '');
}

function TokenView({ t, idx }: { t: Token; idx: number }): ReactNode {
  switch (t.kind) {
    case 'text':
      return <Fragment key={idx}>{t.text}</Fragment>;
    case 'link':
      return (
        <a key={idx} href={t.href} target="_blank" rel="noreferrer" className="deliv-body-link">
          {t.label}
        </a>
      );
    case 'path':
      return (
        <a
          key={idx}
          href={`/api/v1/admin/fs/serve?path=${encodeURIComponent(t.path)}`}
          target="_blank"
          rel="noreferrer"
          className="deliv-body-path"
          title="Click to open · right-click to copy link"
        >
          <code>{t.path}</code>
        </a>
      );
    case 'bold':
      return <strong key={idx}>{t.text}</strong>;
    case 'code':
      return <code key={idx} className="deliv-body-code">{t.text}</code>;
  }
}

export function renderDeliverableBody(text: string): ReactNode {
  const lines = text.split(/\r?\n/);
  return lines.map((line, lineIdx) => (
    <Fragment key={lineIdx}>
      {tokenizeLine(line).map((t, i) => (
        <TokenView key={`${lineIdx}-${i}`} t={t} idx={i} />
      ))}
      {lineIdx < lines.length - 1 && <br />}
    </Fragment>
  ));
}
