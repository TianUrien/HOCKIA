import { describe, it, expect } from 'vitest'
import { profilePath } from '@/lib/profileNavigation'

/**
 * Role-aware profile path builder — the single source of truth for
 * /<role>/id/<uuid> deep links. The brand case is the regression magnet:
 * `/brands/<uuid>` hits the :slug route (a uuid never matches a slug →
 * "brand not found"); brand id links MUST go through /brands/id/
 * (BrandIdRedirect). Search results shipped that exact bug.
 */
describe('profilePath', () => {
  it('routes brand ids through /brands/id/ (BrandIdRedirect), never /brands/<uuid>', () => {
    expect(profilePath('brand', null, 'uuid-1')).toBe('/brands/id/uuid-1')
  })

  it('keeps username-first URLs when available', () => {
    expect(profilePath('player', 'ana', 'p1')).toBe('/players/ana')
    expect(profilePath('club', 'casi', 'c1')).toBe('/clubs/casi')
  })

  it('falls back to /<role>/id/<uuid> per role', () => {
    expect(profilePath('player', null, 'p1')).toBe('/players/id/p1')
    expect(profilePath('coach', null, 'x1')).toBe('/coaches/id/x1')
    expect(profilePath('club', null, 'c1')).toBe('/clubs/id/c1')
    expect(profilePath('umpire', null, 'u1')).toBe('/umpires/id/u1')
  })

  it('returns null for unknown roles or missing ids', () => {
    expect(profilePath('alien', null, 'z1')).toBeNull()
    expect(profilePath('player', null, null)).toBeNull()
  })
})
