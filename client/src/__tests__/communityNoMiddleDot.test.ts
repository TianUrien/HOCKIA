/**
 * Community, World, brands, Hockia AI, inbox and search copy carries no
 * middle-dot or bullet separators (founder rule, 2026-11-19). Same convention
 * and same checks as homeNoMiddleDot.test.ts, for the next group of screens.
 * Code comments are skipped: only what a member can read or hear counts.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
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

const FOLDERS = ['community', 'hockiaAi', 'search', 'brands', 'marketplace', 'pulse', 'notifications', 'inbox']
const FILES = [
  'components/ui/FriendListItem.tsx',
  'components/DiscoverResultCard.tsx',
  'components/WorldClubSearch.tsx',
  'components/WorldSearchDropdown.tsx',
  'components/MemberCard.tsx',
  'components/Footer.tsx',
  'lib/brandOffers.ts',
  'lib/communityCard.ts',
  'lib/hockiaAi.ts',
  'lib/landingRoles.ts',
  'lib/searchV2.ts',
  'pages/BrandAmbassadorsPage.tsx',
  'pages/BrandDashboard.tsx',
  'pages/BrandOffersPage.tsx',
  'pages/BrandResultsPage.tsx',
  'pages/CommunityPage.tsx',
  'pages/DevelopersPage.tsx',
  'pages/WorldClubPage.tsx',
  'hooks/useDocumentTitle.ts',
  'hooks/useFeedAuthorContext.ts',
  'features/chat-v2/components/ChatHeader.tsx',
]
const LOCALES = ['community', 'world', 'brands', 'hockiaAi', 'inbox', 'common', 'enums']

describe('Community, World, brands, Hockia AI, inbox and search: no middle-dot or bullet separators', () => {
  it('the components and helpers build no line with a dot or a bullet', () => {
    const files = [...FOLDERS.flatMap((folder) => walk(join(SRC, 'components', folder))), ...FILES.map((file) => join(SRC, file))]
    expect(files.length).toBeGreaterThan(60)
    const found = files.flatMap((file) =>
      withoutComments(readFileSync(file, 'utf8'))
        .split('\n')
        .flatMap((line, i) => (DOT.test(line) ? [`${relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])),
    )
    expect(found).toEqual([])
  })

  it.each(['en', 'es'])('the strings (%s) carry no dot or bullet', (lang) => {
    const found = LOCALES.flatMap((name) =>
      strings(JSON.parse(readFileSync(join(SRC, 'locales', lang, `${name}.json`), 'utf8')), '', [])
        .filter(([, value]) => DOT.test(value))
        .map(([key, value]) => `${lang}/${name}.json ${key}: ${value}`),
    )
    expect(found).toEqual([])
  })

  it('the helpers join same-kind facts with a comma and separate lists with a full stop', async () => {
    const { cardPlaceLine, clubMetaLine } = await import('@/lib/communityCard')
    const { memberMetaLine } = await import('@/lib/searchV2')
    const { audienceLine } = await import('@/lib/brandOffers')
    const { roleResultMeta } = await import('@/lib/hockiaAi')
    expect(cardPlaceLine(22, 'Buenos Aires')).toBe('22, Buenos Aires')
    expect(clubMetaLine({ recruiting: false, positions: [], league: 'Serie A Elite', place: 'Rome, Italy' })).toBe('Serie A Elite, Rome, Italy')
    expect(memberMetaLine({ role: 'player', position: 'midfielder', currentClub: 'HC Rotterdam' })).toBe('Midfielder, HC Rotterdam')
    expect(audienceLine(['England', 'Netherlands'], ['player', 'coach'])).toBe('England, Netherlands. Players, coaches')
    expect(roleResultMeta({ league_label: 'Serie A1', location_label: null, benefit_labels: ['Housing', 'Paid'] })).toBe('Serie A1. Housing, Paid')
  })

  it('browser tab titles end like the server-rendered page titles', () => {
    expect(readFileSync(join(SRC, 'hooks', 'useDocumentTitle.ts'), 'utf8')).toContain("const SUFFIX = ' | Hockia'")
  })
})
