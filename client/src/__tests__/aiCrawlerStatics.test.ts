/**
 * Static contracts for crawlers that do not run JavaScript (2026-11-18):
 * /llms.txt is a real text file, private routes are noindex at the server,
 * and the home page's Organization data says what Hockia is.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NOINDEX, resolveRouteMeta } from '@/lib/seo/routeMeta'
import { renderStaticHtml } from '@/lib/seo/opportunityHead'

const root = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

interface VercelConfig {
  headers: { source: string; has?: unknown; headers: { key: string; value: string }[] }[]
  rewrites: { source: string; destination: string }[]
}
const vercel = JSON.parse(read('vercel.json')) as VercelConfig

/** The noindex header sources use only plain regex groups, so they read as regexes. */
const noindexSources = vercel.headers
  .filter((h) => !h.has && h.headers.some((x) => x.key === 'X-Robots-Tag' && x.value === 'noindex, nofollow'))
  .map((h) => new RegExp(`^${h.source}$`))
const serverNoindex = (p: string) => noindexSources.some((re) => re.test(p))

describe('/llms.txt', () => {
  const text = read('public/llms.txt')

  it('says what Hockia is, that it is free, and links the key pages', () => {
    expect(text.startsWith('# Hockia (inhockia.com)')).toBe(true)
    expect(text).toContain('the field hockey network for players, coaches, clubs, umpires and brands')
    expect(text).toMatch(/free/i)
    for (const url of [
      'https://inhockia.com/opportunities', 'https://inhockia.com/world', 'https://inhockia.com/community', 'https://inhockia.com/developers',
      'https://apps.apple.com/app/hockia/id6760937891', 'https://play.google.com/store/apps/details?id=com.inhockia.app',
    ]) expect(text).toContain(url)
  })

  it('is served as text/plain and never falls through to the app shell', () => {
    const header = vercel.headers.find((h) => h.source === '/llms.txt')
    expect(header?.headers).toContainEqual({ key: 'Content-Type', value: 'text/plain; charset=utf-8' })
    const own = vercel.rewrites.findIndex((r) => r.source === '/llms.txt')
    const shell = vercel.rewrites.findIndex((r) => r.destination === '/app.html')
    expect(vercel.rewrites[own]).toEqual({ source: '/llms.txt', destination: '/llms.txt' })
    expect(own).toBeLessThan(shell)
    expect(read('vite.config.ts')).toContain('/^\\/llms\\.txt$/')
  })
})

describe('server-side noindex', () => {
  const PRIVATE = [
    '/admin', '/admin/users', '/dashboard', '/dashboard/profile', '/settings', '/messages/abc', '/inbox', '/home', '/pulse', '/search',
    '/discover', '/discovery', '/notifications', '/complete-profile', '/onboarding/role', '/auth/callback', '/email-action/x',
    '/verify-email', '/forgot-password', '/reset-password', '/offline', '/opportunities/applications',
    '/opportunities/123e4567-e89b-12d3-a456-426614174000/applicants', '/opportunities/new', '/saved', '/shortlist', '/shortlists/1',
    '/investors/deck', '/invite/abc', '/l/abc', '/members/id/1', '/players/id/1', '/brands/id/1', '/signin', '/signup/email',
  ]
  const PUBLIC = [
    '/', '/opportunities', '/opportunities/123e4567-e89b-12d3-a456-426614174000', '/community', '/community/clubs', '/world', '/world/ar',
    '/world/clubs/123e4567-e89b-12d3-a456-426614174000', '/marketplace', '/developers', '/terms', '/privacy-policy', '/signup',
    '/players/some-player', '/clubs/some-club', '/brands/some-brand', '/llms.txt', '/robots.txt', '/homepage', '/searching',
  ]

  it('every client noindex rule has a path in the sample', () => {
    for (const re of NOINDEX) expect(PRIVATE.some((p) => re.test(p)), String(re)).toBe(true)
  })

  it('the header rules and the client rules agree on private and public paths', () => {
    for (const p of PRIVATE) {
      expect(resolveRouteMeta(p).index, p).toBe(false)
      expect(serverNoindex(p), p).toBe(true)
    }
    for (const p of PUBLIC) {
      expect(serverNoindex(p), p).toBe(false)
      if (!p.includes('.')) expect(resolveRouteMeta(p).index, p).toBe(true)
    }
  })

  it('/signin and /signup/email carry the robots tag in the initial HTML', () => {
    const shell = '<html><head><title>Hockia</title></head><body><div id="root"></div></body></html>'
    for (const p of ['/signin', '/signup/email']) {
      expect(vercel.rewrites).toContainEqual({ source: p, destination: `/api/page-head?path=${p}` })
      expect(renderStaticHtml(shell, p, 'https://inhockia.com')).toContain('<meta name="robots" content="noindex, nofollow" />')
    }
    expect(renderStaticHtml(shell, '/signup', 'https://inhockia.com')).not.toContain('name="robots"')
  })
})

describe('home Organization JSON-LD', () => {
  const html = read('index.html')
  const graph = (JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? '{}') as { '@graph': Record<string, unknown>[] })['@graph']
  const org = graph.find((n) => n['@type'] === 'Organization') ?? {}

  it('describes Hockia as a field hockey network and keeps its profiles', () => {
    expect(String(org.description)).toContain('field hockey network')
    expect(org.areaServed).toBe('Worldwide')
    expect(org.foundingDate).toBe('2025') // year of the first commit (2025-11-13)
    expect(org.knowsAbout).toContain('Field hockey')
    expect(org.sameAs).toEqual([
      'https://www.instagram.com/inhockia/', 'https://www.linkedin.com/company/hockia/', 'https://www.facebook.com/profile.php?id=61590881692674',
      'https://apps.apple.com/app/hockia/id6760937891', 'https://play.google.com/store/apps/details?id=com.inhockia.app',
    ])
  })

  it('names no person', () => {
    expect(org.founder).toBeUndefined()
  })
})
