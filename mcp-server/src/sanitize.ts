// Member-written text (role descriptions, bios, titles) goes back to an AI
// assistant. It is data, not instructions, but a hostile member could still
// write text aimed at the assistant. Before returning it: drop control and
// invisible characters, remove links, and cap the length. Fields that are
// meant to be links (a club's website) are kept as they are.

const KEEP_AS_IS = new Set(['website']);
const MAX_STRING = 4000;

// C0/C1 controls except tab and newline, zero-width and bidi-override characters, BOM.
const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const MARKUP = /<\/?[a-z][^>]*>/gi;

export function cleanText(value: string): string {
  return value
    .replace(INVISIBLE, '')
    .replace(MARKUP, '')
    // One markup pass can leave a tag behind (`<scr<script>ipt>` becomes
    // `<script>`), so drop every angle bracket that is left.
    .replace(/[<>]/g, '')
    .replace(LINK, '[link removed]')
    .slice(0, MAX_STRING);
}

export function sanitize(value: unknown, key?: string): unknown {
  if (typeof value === 'string') return key && KEEP_AS_IS.has(key) ? value.slice(0, 300) : cleanText(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  }
  return value;
}
