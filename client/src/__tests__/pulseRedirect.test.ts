/**
 * "Your activity" moved into Inbox › Activity (founder 2026-11-24). Old apps,
 * emails and bookmarks still open /pulse, so the route must stay and land
 * there, and no screen may link to /pulse any more.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = join(__dirname, '..')
const read = (p: string) => readFileSync(join(src, p), 'utf8')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (name === '__tests__' || name === 'locales') continue
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

describe('/pulse', () => {
  it('redirects to Inbox › Activity and keeps the query', () => {
    const app = read('App.tsx')
    expect(app).toContain('<Route path="/pulse" element={<PulseRedirect />} />')
    expect(app).toContain('<Navigate to={`/inbox/activity${search}`} replace />')
  })

  it('is not linked from any screen', () => {
    const offenders = sourceFiles(src).filter((f) => {
      const text = readFileSync(f, 'utf8')
      return /(to|href)=["']\/pulse/.test(text) || /navigate\(['"]\/pulse/.test(text) || /to: ['"]\/pulse/.test(text)
    })
    expect(offenders.map((f) => f.replace(src, ''))).toEqual([])
  })
})
