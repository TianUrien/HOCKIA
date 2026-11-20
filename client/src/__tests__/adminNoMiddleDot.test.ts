/**
 * Admin screens carry no middle-dot or bullet separators (founder rule,
 * 2026-11-19). Same convention and same scan as homeNoMiddleDot.test.ts:
 * a comma between facts of the same kind, a separate element with a real space
 * between facts of different kinds, a full stop or a colon between two phrases,
 * and never another glyph in place of the dot. Code comments are skipped.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(__dirname, '..')

/** Middle dots, bullets and their look-alikes, as characters or as escapes. */
const DOT = /[·•∙⋅‧●・]|&middot;|&bull;|&#183;|&#8226;|&#x(?:b7|2022);|\\u00b7|\\u2022/i

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : walk(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** Blank out block comments (JSX ones included) and line comments, keeping line numbers. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1')
}

describe('Admin: no middle-dot or bullet separators', () => {
  it('no admin file builds a line with a dot or a bullet', () => {
    const files = walk(join(SRC, 'features', 'admin'))
    expect(files.length).toBeGreaterThan(50)
    const found = files.flatMap((file) =>
      withoutComments(readFileSync(file, 'utf8'))
        .split('\n')
        .flatMap((line, i) => (DOT.test(line) ? [`${relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])),
    )
    expect(found).toEqual([])
  })
})
