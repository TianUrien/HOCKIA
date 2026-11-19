/**
 * Recruiting, opportunities and club copy carries no middle-dot or bullet
 * separators (founder rule 2026-11-19; homeNoMiddleDot.test.ts sets the
 * pattern and explains the convention). Code comments are skipped: only what
 * a member can read or hear counts.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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

function strings(node: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof node === 'string') out.push([path, node])
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) strings(value, path ? `${path}.${key}` : key, out)
  }
  return out
}

const COMPONENTS = ['ApplyToOpportunityModal', 'ApplicantCard', 'OpportunitiesTab', 'OpportunityDetailView', 'PublishConfirmationModal', 'ClubMembersTab']
const LIBS = ['clubInbox', 'clubProfileCopy', 'clubRecruiting', 'clubSquad', 'coachRoles', 'invites', 'opportunityCopy', 'postRoleAi', 'signing', 'findPlayers']
const LOCALES = ['recruiting.json', 'opportunities.json', 'opportunities.core.json', 'club.json']

describe('Recruiting, opportunities and club: no middle-dot or bullet separators', () => {
  it('the components, pages and helpers build no line with a dot or a bullet', () => {
    const files = [
      ...walk(join(SRC, 'components', 'opportunities')),
      ...walk(join(SRC, 'components', 'recruiting')),
      ...walk(join(SRC, 'components', 'club')),
      ...COMPONENTS.map((name) => join(SRC, 'components', `${name}.tsx`)),
      ...LIBS.map((name) => join(SRC, 'lib', `${name}.ts`)),
      join(SRC, 'pages', 'MyApplicationsPage.tsx'),
      join(SRC, 'pages', 'OfferDetailPage.tsx'),
      join(SRC, 'features', 'chat-v2', 'components', 'InviteCard.tsx'),
    ]
    expect(files.length).toBeGreaterThan(60)
    const found = files.flatMap((file) =>
      withoutComments(readFileSync(file, 'utf8'))
        .split('\n')
        .flatMap((line, i) => (DOT.test(line) ? [`${relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])),
    )
    expect(found).toEqual([])
  })

  it.each(['en', 'es'])('the strings (%s) carry no dot or bullet', (lang) => {
    const dir = join(SRC, 'locales', lang)
    const files = LOCALES.filter((name) => existsSync(join(dir, name)))
    expect(files).toContain('recruiting.json')
    const found = files.flatMap((name) =>
      strings(JSON.parse(readFileSync(join(dir, name), 'utf8')), '', [])
        .filter(([, value]) => DOT.test(value))
        .map(([key, value]) => `${lang}/${name} ${key}: ${value}`),
    )
    expect(found).toEqual([])
  })
})
