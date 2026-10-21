/**
 * Design audit 2026-10-21, A10: the EU badge is #003399 text on #E6EDFF on
 * light surfaces (tokens eu-ink / eu-soft) and white on blue 85 % only over
 * photos (eu-solid). One component with a `surface` prop; no raw hex.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import { EuBadge, NationalityLine } from '@/components/ui/NationalityBadges'
import { euBadgeTone } from '@/lib/euBadge'

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('EuBadge surface', () => {
  it('tokens hold the foundation values', () => {
    const css = src('styles/tokens/tokens.css')
    expect(css).toContain('--eu-ink: #003399;')
    expect(css).toContain('--eu-soft: #e6edff;')
    expect(css).toContain('--eu-solid: #003399d9;')
  })
  it('light = blue text on soft blue; photo = white on solid blue', () => {
    expect(euBadgeTone('light')).toBe('bg-eu-soft text-eu-ink')
    expect(euBadgeTone('photo')).toBe('bg-eu-solid text-white')
    render(<EuBadge surface="light" />)
    const b = screen.getByTestId('eu-badge')
    expect(b.className).toContain('bg-eu-soft')
    expect(b.className).not.toContain('text-white')
    expect(b.getAttribute('style')).toBeNull()
  })
  it('NationalityLine picks the surface from its background', () => {
    const eu = [{ id: 1, name: 'Spain', flag: '🇪🇸', isEu: true }] as never
    const { unmount } = render(<NationalityLine nationalities={eu} dark={false} />)
    expect(screen.getByTestId('eu-badge').getAttribute('data-surface')).toBe('light')
    unmount()
    render(<NationalityLine nationalities={eu} />)
    expect(screen.getByTestId('eu-badge').getAttribute('data-surface')).toBe('photo')
  })
  it('the deck details panel uses the light badge; the photo keeps the solid one', () => {
    const s = src('components/community/photo/MemberFullPreview.tsx')
    expect(s).toContain('<EuBadge surface="light" /> EU passport')
    expect(s).toContain('<EuBadge surface="photo"')
  })
  it('no raw EU hex left in components', () => {
    for (const f of ['components/ui/NationalityBadges.tsx', 'components/community/photo/MemberFullPreview.tsx', 'components/club/ApplicantReviewScreen.tsx']) {
      expect(src(f)).not.toMatch(/#003399|#e5edff|#E6EDFF|0,51,153/i)
    }
  })
})
