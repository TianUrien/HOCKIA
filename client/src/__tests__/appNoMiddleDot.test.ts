/**
 * No middle-dot or bullet separators anywhere a person reads text in the app
 * (founder rule, extended to every screen on 2026-11-19).
 *
 * The convention this guards (docs/engineering/standards.md, "Copy and status rules"):
 *   - facts of the same kind in one line: a comma and a space ("Player, Argentina");
 *   - facts of different kinds (a role, then a time or a count): no separator
 *     character, the second one in its own element, with a real space between;
 *   - a title made of two phrases: a full stop, a colon or a line break;
 *   - the dot is never swapped for another glyph.
 *
 * This is the whole-app net: every source file and every locale file. The
 * per-area tests next to it pin the helpers of each area. Code comments are
 * skipped: only what can be read or heard on screen counts.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(__dirname, '..')

/** Middle dots, bullets and their look-alikes, as characters or as escapes. */
const DOT = /[·•∙⋅‧●・]|&middot;|&bull;|&#183;|&#8226;|&#x(?:b7|2022);|\\u00b7|\\u2022/i

function walk(dir: string, match: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : walk(path, match)
    return match.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** Blank out block comments (JSX ones included) and line comments, keeping line numbers. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1')
}

function strings(node: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof node === 'string') out.push([path, node])
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) strings(value, path ? `${path}.${key}` : key, out)
  }
  return out
}

describe('whole app: no middle-dot or bullet separators', () => {
  it('no source file builds a line with a dot or a bullet', () => {
    const files = walk(SRC, /\.(ts|tsx)$/)
    expect(files.length).toBeGreaterThan(500)
    const found = files.flatMap((file) =>
      withoutComments(readFileSync(file, 'utf8'))
        .split('\n')
        .flatMap((line, i) => (DOT.test(line) ? [`${relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])),
    )
    expect(found).toEqual([])
  })

  it.each(['en', 'es'])('no %s string carries a dot or a bullet', (lang) => {
    const dir = join(SRC, 'locales', lang)
    const files = readdirSync(dir).filter((name) => name.endsWith('.json'))
    expect(files.length).toBeGreaterThan(10)
    const found = files.flatMap((name) =>
      strings(JSON.parse(readFileSync(join(dir, name), 'utf8')), '', [])
        .filter(([, value]) => DOT.test(value))
        .map(([key, value]) => `${lang}/${name} ${key}: ${value}`),
    )
    expect(found).toEqual([])
  })
})
