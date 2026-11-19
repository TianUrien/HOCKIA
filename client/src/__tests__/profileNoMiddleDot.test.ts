/**
 * Profile, media, settings and onboarding copy carries no middle-dot or bullet
 * separators (founder rule, 2026-11-19). Same convention and same scan as
 * homeNoMiddleDot.test.ts: commas for facts of one kind, a separate element
 * for a fact of another kind, a full stop or a colon between two phrases.
 * Code comments are skipped: only what a member can read or hear counts.
 */
import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// The helpers import the Supabase client, which throws without its environment
// variables (CI has none).
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    functions: { invoke: vi.fn() },
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
  AUTH_STORAGE_KEY: 'hockia-auth',
  SUPABASE_URL: 'https://test.supabase.local',
  SUPABASE_ANON_KEY: 'test-anon-key',
}))

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

const COMPONENTS = ['JourneyTab', 'DualNationalityDisplay', 'UmpireAppointmentEditor', 'UmpireAppointmentsSection', 'FullGameVideosSection', 'ProfileViewersSection', 'MagicLinkForm']
const HELPERS = ['identity', 'keyFacts', 'nationality', 'nationalityLine', 'openToPlayScreen', 'profileD2']
const LOCALES = ['profile', 'profileEdit', 'media', 'settings', 'onboarding', 'onboarding.core']

describe('Profile, media, settings and onboarding: no middle-dot or bullet separators', () => {
  it('the components, pages and helpers build no line with a dot or a bullet', () => {
    const files = [
      ...walk(join(SRC, 'components', 'profile')),
      ...walk(join(SRC, 'components', 'dashboard')),
      ...walk(join(SRC, 'components', 'settings')),
      ...COMPONENTS.map((name) => join(SRC, 'components', `${name}.tsx`)),
      ...HELPERS.map((name) => join(SRC, 'lib', `${name}.ts`)),
      join(SRC, 'pages', 'AuthScreen.tsx'),
      join(SRC, 'pages', 'UmpireDashboard.tsx'),
      join(SRC, 'hooks', 'usePublicProfileMeta.ts'),
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
    const files = LOCALES.map((name) => `${name}.json`).filter((name) => existsSync(join(dir, name)))
    expect(files).toContain('profile.json')
    const found = files.flatMap((name) =>
      strings(JSON.parse(readFileSync(join(dir, name), 'utf8')), '', [])
        .filter(([, value]) => DOT.test(value))
        .map(([key, value]) => `${lang}/${name} ${key}: ${value}`),
    )
    expect(found).toEqual([])
  })

  it('the helpers join facts of one kind with a comma', async () => {
    const { identityLine } = await import('@/lib/identity')
    const { nationalityNames, ageCityLine } = await import('@/lib/nationality')
    expect(identityLine('player', 'midfielder')).toBe('Player, Midfielder')
    // Both nationalities stay, in order: only the separator changed.
    expect(nationalityNames([{ flag: '🇦🇷', name: 'Argentina' }, { flag: '🇮🇹', name: 'Italy' }] as never)).toBe('🇦🇷 Argentina, 🇮🇹 Italy')
    expect(ageCityLine(29, { city: 'Santander', country: 'Spain', flag: '🇪🇸' } as never)).toBe('29, Santander')
  })
})
