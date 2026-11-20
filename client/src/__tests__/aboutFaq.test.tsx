/**
 * /about and /faq (founder-approved text, 2026-11-20): one source for the
 * pages, the no-JavaScript body and the JSON-LD; the country count is live.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const from = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

import {
  aboutBody, aboutItems, aboutJsonLd, countriesAnswer, directoryFacts, faqBody, faqItems, faqJsonLd, injectJsonLd, UNKNOWN_FACTS, weekWindows,
} from '@/lib/seo/aboutFaq'
import { injectServerBody } from '@/lib/seo/serverBody'
import { resolveRouteMeta } from '@/lib/seo/routeMeta'
import FaqPage from '@/pages/FaqPage'
import AboutPage from '@/pages/AboutPage'

const root = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')
const LIVE = { countries: 31, addedEveryWeek: true }
const SHELL = '<html><head><title>t</title></head><body><div id="root"></div></body></html>'

/** A chainable stand-in for one supabase-js query. */
function query(result: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'gte', 'lt', 'limit']) q[m] = () => q
  q.then = (ok: (r: typeof result) => unknown) => Promise.resolve(result).then(ok)
  return q
}

describe('the countries answer', () => {
  it('carries the live number and the weekly clause only when both hold', () => {
    expect(countriesAnswer(LIVE)).toBe('Hockia is open worldwide. The directory lists clubs in 31 countries, and new clubs are added every week.')
    expect(countriesAnswer({ countries: 31, addedEveryWeek: false })).toBe('Hockia is open worldwide. The directory lists clubs in 31 countries.')
    expect(countriesAnswer(UNKNOWN_FACTS)).toBe('Hockia is open worldwide.')
    expect(countriesAnswer({ countries: 0, addedEveryWeek: true })).toBe('Hockia is open worldwide.')
  })

  it('counts countries with at least one club and needs a club in each of the four weeks', () => {
    expect(directoryFacts([3, 0, null, 12], [true, true, true, true])).toEqual({ countries: 2, addedEveryWeek: true })
    expect(directoryFacts([3, 12], [true, false, true, true]).addedEveryWeek).toBe(false)
    expect(directoryFacts([3, 12], [true, null, true, true]).addedEveryWeek).toBe(false)
    expect(directoryFacts([3, 12], [true, true, true]).addedEveryWeek).toBe(false)
    expect(directoryFacts(null, [true, true, true, true])).toEqual(UNKNOWN_FACTS)
    expect(directoryFacts([0, null], [true, true, true, true])).toEqual(UNKNOWN_FACTS)
  })

  it('checks four back-to-back weeks ending now', () => {
    const w = weekWindows(new Date('2026-11-20T12:00:00Z'))
    expect(w).toHaveLength(4)
    expect(w[0]).toEqual({ from: '2026-11-13T12:00:00.000Z', to: '2026-11-20T12:00:00.000Z' })
    expect(w[3].from).toBe('2026-10-23T12:00:00.000Z')
    expect(w[1].to).toBe(w[0].from)
  })
})

describe('the approved text', () => {
  const items = faqItems(LIVE)

  it('has the ten questions, with no draft notes left', () => {
    expect(items.map((i) => i.question)).toEqual([
      'What is Hockia?', 'Is Hockia free?', 'Who is Hockia for?', 'How do clubs recruit on Hockia?', 'Can I find a field hockey club abroad?',
      'Which countries does Hockia cover?', 'How do I apply for a role?', 'Is Hockia for field hockey or ice hockey?', 'How do I get the app?', 'Who runs Hockia?',
    ])
    expect(items.find((i) => i.id === 'free')?.answer).toBe('Yes. Creating a profile, browsing and applying to roles, and publishing roles as a club are free.')
    expect(items.find((i) => i.id === 'who-runs')?.answer).toBe('Hockia was founded by Cristian Urien and is built by a small independent team of field hockey people.')
    for (const i of items) expect(`${i.question} ${i.answer}`).not.toMatch(/confirm|\*|to write/i)
  })

  it('/about shows six of the same answers, unchanged', () => {
    const about = aboutItems(LIVE)
    expect(about.map((i) => i.id)).toEqual(['what', 'who-for', 'free', 'sport', 'app', 'who-runs'])
    for (const a of about) expect(items).toContainEqual(a)
  })
})

describe('without JavaScript', () => {
  it('/faq body has every question and answer, escaped, inside the shell', () => {
    const html = injectServerBody(SHELL, faqBody(LIVE))
    expect(html).toContain('<h1>Frequently asked questions</h1>')
    for (const i of faqItems(LIVE)) expect(html).toContain(`<h2>${i.question}</h2>`)
    expect(html).toContain('clubs in 31 countries, and new clubs are added every week.')
    expect(html).toContain("each applicant's profile")
    expect(html).toContain('<a href="/about">About Hockia</a>')
  })

  it('/about body has its six answers and links to /faq', () => {
    const html = aboutBody(UNKNOWN_FACTS)
    expect(html).toContain('<h1>About Hockia</h1>')
    expect(html).toContain('founded by Cristian Urien')
    expect(html).not.toContain('Which countries')
    expect(html).toContain('<a href="/faq">Frequently asked questions</a>')
  })

  it('FAQPage JSON-LD repeats the page text; AboutPage names no person', () => {
    const faq = faqJsonLd(LIVE, 'https://inhockia.com') as { '@type': string; mainEntity: { name: string; acceptedAnswer: { text: string } }[] }
    expect(faq['@type']).toBe('FAQPage')
    expect(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(faqItems(LIVE).map((i) => [i.question, i.answer]))
    const about = aboutJsonLd('https://inhockia.com')
    expect(about).toMatchObject({ '@type': 'AboutPage', url: 'https://inhockia.com/about' })
    expect(JSON.stringify(about)).not.toMatch(/founder|Person|Urien/)
    const html = injectJsonLd(SHELL, faq)
    expect(html).toMatch(/<script type="application\/ld\+json" data-server="1">\{.*\}<\/script>\n<\/head>/)
    expect(JSON.parse(html.match(/data-server="1">(.*)<\/script>/)![1])['@type']).toBe('FAQPage')
  })
})

describe('routing, sitemap and llms.txt', () => {
  it('both pages are indexable, served through page-head, and listed', () => {
    const vercel = JSON.parse(read('vercel.json')) as { rewrites: { source: string; destination: string }[] }
    const shell = vercel.rewrites.findIndex((r) => r.destination === '/app.html')
    for (const p of ['/about', '/faq']) {
      expect(resolveRouteMeta(p)).toMatchObject({ index: true })
      expect(resolveRouteMeta(p).title).toBeTruthy()
      const own = vercel.rewrites.findIndex((r) => r.source === p)
      expect(vercel.rewrites[own]).toEqual({ source: p, destination: `/api/page-head?path=${p}` })
      expect(own).toBeLessThan(shell)
      expect(read('public/llms.txt')).toContain(`https://inhockia.com${p})`)
      expect(read('../supabase/functions/sitemap/index.ts')).toContain(`{ path: '${p}',`)
    }
  })
})

describe('the pages', () => {
  it('/faq renders the ten answers and fills in the live count', async () => {
    from.mockImplementation((table: string) =>
      table === 'world_countries_with_directory'
        ? query({ data: [{ total_clubs: 4 }, { total_clubs: 0 }, { total_clubs: 9 }], error: null })
        : query({ data: [{ id: 'x' }], error: null }),
    )
    render(<MemoryRouter><FaqPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Frequently asked questions' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(10)
    await waitFor(() => expect(screen.getByTestId('faq-countries')).toHaveTextContent('The directory lists clubs in 2 countries, and new clubs are added every week.'))
    expect(screen.getByTestId('faq-countries').querySelector('p')?.className).toContain('text-ink-2')
  })

  it('/faq shows the sentence without a number when the directory cannot be read', async () => {
    from.mockImplementation(() => query({ data: null, error: { message: 'down' } }))
    render(<MemoryRouter><FaqPage /></MemoryRouter>)
    await waitFor(() => expect(from).toHaveBeenCalled())
    expect(screen.getByTestId('faq-countries')).toHaveTextContent('Which countries does Hockia cover?Hockia is open worldwide.')
    expect(screen.getByTestId('faq-countries').textContent).not.toMatch(/\d/)
  })

  it('/about renders its six answers and links to /faq, with no directory read', () => {
    from.mockClear()
    render(<MemoryRouter><AboutPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'About Hockia' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(6)
    expect(screen.getByRole('link', { name: 'Frequently asked questions' })).toHaveAttribute('href', '/faq')
    expect(from).not.toHaveBeenCalled()
  })
})
