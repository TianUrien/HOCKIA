/**
 * Home copy carries no middle-dot or bullet separators (founder rule, extended
 * to every in-app screen on 2026-11-19; the Home sets the pattern).
 *
 * The convention this guards:
 *   - facts of the same kind in one line: a comma and a space ("Player, Argentina");
 *   - facts of different kinds (a role, then a time): no separator character,
 *     the second one in its own element with a gap and the secondary colour;
 *   - a title made of two phrases: a full stop or a line break;
 *   - the dot is never swapped for another glyph.
 *
 * Same idea as supabase/functions/_shared/email-polish.test.ts. Code comments
 * are skipped: only what a member can read or hear counts.
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

function offences(path: string, text: string): string[] {
  return text
    .split('\n')
    .flatMap((line, i) => (DOT.test(line) ? [`${relative(SRC, path)}:${i + 1}: ${line.trim().slice(0, 120)}`] : []))
}

function strings(node: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof node === 'string') out.push([path, node])
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) strings(value, path ? `${path}.${key}` : key, out)
  }
  return out
}

describe('Home: no middle-dot or bullet separators', () => {
  it('the comment stripper keeps code and drops comments', () => {
    const sample = ["const a = 'x · y' // note · here", '/* block · */ const b = 1', "const url = 'https://h.test/a'"].join('\n')
    const clean = withoutComments(sample)
    expect(clean.split('\n')[0]).toContain("'x · y'")
    expect(clean.split('\n')[0]).not.toContain('note')
    expect(DOT.test(clean.split('\n')[1])).toBe(false)
    expect(clean.split('\n')[2]).toContain('https://h.test/a')
  })

  it('Home components and the Home helpers build no line with a dot or a bullet', () => {
    const files = [
      ...walk(join(SRC, 'components', 'home')),
      join(SRC, 'pages', 'HomePage.tsx'),
      join(SRC, 'lib', 'homeEngagement.ts'),
      join(SRC, 'lib', 'memberGoals.ts'),
    ]
    expect(files.length).toBeGreaterThan(40)
    const found = files.flatMap((file) => offences(file, withoutComments(readFileSync(file, 'utf8'))))
    expect(found).toEqual([])
  })

  it.each(['en', 'es'])('Home strings (%s) carry no dot or bullet', (lang) => {
    const dir = join(SRC, 'locales', lang)
    const files = readdirSync(dir).filter((name) => /^home(\..+)?\.json$/.test(name))
    expect(files).toContain('home.json')
    const found = files.flatMap((name) =>
      strings(JSON.parse(readFileSync(join(dir, name), 'utf8')), '', [])
        .filter(([, value]) => DOT.test(value))
        .map(([key, value]) => `${lang}/${name} ${key}: ${value}`),
    )
    expect(found).toEqual([])
  })

  it('the helpers join facts with a comma, and goals with a full stop', async () => {
    const { roleTitle, signingDetail } = await import('@/lib/homeEngagement')
    const { goalTitle } = await import('@/lib/memberGoals')
    expect(signingDetail({ signing_role: "Women's 1st team", person_position: 'defender', season: '2027' })).toBe("Women's 1st team, 2027")
    expect(DOT.test(roleTitle('midfielder', 'Men', 'Role'))).toBe(false)
    expect(roleTitle('midfielder', 'Men', 'Role')).toContain(', ')
    const title = goalTitle('player', { options: [], other_text: 'Play in Germany' })
    expect(title).toBe('Play in Germany')
    expect(DOT.test(goalTitle('player', { options: ['a', 'b', 'c', 'd', 'e', 'f'], other_text: 'x' }))).toBe(false)
  })
})
