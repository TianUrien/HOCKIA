import { describe, it, expect } from 'vitest'
import { isYouthGender, playerRoleGender } from '@/lib/youthRoles'

// Founder ruling 2026-09-25 (C): under-18s are never recruitable → no youth PLAYER roles.
describe('youthRoles', () => {
  it('flags Boys and Girls only', () => {
    expect(isYouthGender('Boys')).toBe(true)
    expect(isYouthGender('Girls')).toBe(true)
    for (const g of ['Men', 'Women', 'Mixed', null, undefined, '']) expect(isYouthGender(g)).toBe(false)
  })

  it('drops a youth team from a player role and keeps adult ones', () => {
    expect(playerRoleGender('Boys')).toBeNull()
    expect(playerRoleGender('Girls')).toBeNull()
    expect(playerRoleGender('Women')).toBe('Women')
    expect(playerRoleGender(null)).toBeNull()
  })
})
