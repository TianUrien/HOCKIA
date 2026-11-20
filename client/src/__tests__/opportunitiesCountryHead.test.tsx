/**
 * The rendered head of /opportunities/in/:slug (2026-11-20 follow-up).
 * Google indexes what the app ends with, so after the lazy list page has
 * mounted, the title, description, og:* and canonical must be the country's,
 * the same ones the server sent, and the canonical carries no query.
 */
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => {
  const builder = () => {
    const result = () => Promise.resolve({ data: [], count: 0, error: null })
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'neq', 'gte', 'lt', 'or', 'not', 'is', 'range', 'update', 'insert', 'upsert']) chain[m] = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
    chain.single = () => Promise.resolve({ data: null, error: null })
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej)
    return chain
  }
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: vi.fn() }
  return {
    supabase: {
      from: () => builder(),
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      channel: () => channel,
      removeChannel: vi.fn(),
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) },
    },
  }
})
const authState = { user: null, profile: null }
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(authState) : authState), { getState: () => authState }),
}))

import { RouteMeta } from '@/components/RouteMeta'
import { OpportunitiesCountryEntry, OpportunitiesEntry } from '@/pages/ClubRecruitingRoutes'

const HEAD = `
  <title>Hockia</title>
  <meta name="description" content="shell" />
  <meta property="og:title" content="shell" />
  <meta property="og:description" content="shell" />
  <meta property="og:url" content="https://inhockia.com" />
`
const meta = (selector: string) => document.head.querySelector(selector)?.getAttribute('content')
const canonical = () => document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')

let search = ''
function Where() {
  search = useLocation().search
  return null
}

function open(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <RouteMeta />
        <Where />
        <Routes>
          <Route path="/opportunities" element={<OpportunitiesEntry />} />
          <Route path="/opportunities/in/:slug" element={<OpportunitiesCountryEntry />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('the head the app ends with', () => {
  beforeEach(() => {
    document.head.innerHTML = HEAD
    search = ''
  })

  it('/opportunities/in/germany ends with the country title, description and a canonical without the query', async () => {
    const view = open('/opportunities/in/germany')
    const title = 'Open Field Hockey Roles in Germany – Jobs for Players & Coaches | Hockia'
    // The list page is a lazy chunk: wait until it has mounted and written the head.
    await view.findAllByTestId(/^opportunit/, {}, { timeout: 15_000 })
    await waitFor(() => expect(document.title).toBe(title))
    expect(search).toBe('?country=Germany')
    expect(meta('meta[name="description"]')).toMatch(/^Open field hockey roles in Germany for players and coaches/)
    expect(meta('meta[property="og:title"]')).toBe(title)
    expect(meta('meta[property="og:url"]')).toBe('https://inhockia.com/opportunities/in/germany')
    expect(canonical()).toBe('https://inhockia.com/opportunities/in/germany')
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  }, 20_000)

  it('/opportunities keeps its own head', async () => {
    const view = open('/opportunities')
    await view.findAllByTestId(/^opportunit/, {}, { timeout: 15_000 })
    expect(document.title).not.toMatch(/Germany/)
    expect(meta('meta[property="og:url"]')).toBe('https://inhockia.com/opportunities')
    expect(canonical()).toBe('https://inhockia.com/opportunities')
  }, 20_000)
})
