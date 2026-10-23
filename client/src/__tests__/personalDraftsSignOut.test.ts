/**
 * Drafts that can hold a date of birth or nationality are cleared from the
 * browser on sign-out (CodeQL clear-text storage, 2026-10-23); other keys stay.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { clearPersonalDraftsOnDevice } from '@/lib/profileDrafts'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('clearPersonalDraftsOnDevice', () => {
  beforeEach(() => localStorage.clear())
  it('removes profile, onboarding and role drafts for any user, and nothing else', () => {
    const personal = ['profileDraft:player:u1', 'hockia-onboarding-v2:player:u1', 'hockia-onboarding-v2:coach:u2', 'hockia-onboarding-draft:umpire:u3', 'vacancyDraft:new:c1']
    const kept = ['sb-auth-token', 'hockia-ai-tip-seen', 'messageDraft:abc']
    for (const k of [...personal, ...kept]) localStorage.setItem(k, '{}')
    clearPersonalDraftsOnDevice()
    for (const k of personal) expect(localStorage.getItem(k), k).toBeNull()
    for (const k of kept) expect(localStorage.getItem(k), k).toBe('{}')
  })
  it('sign-out calls it', () => {
    expect(readFileSync(resolve(__dirname, '../lib/auth.ts'), 'utf8')).toContain('clearPersonalDraftsOnDevice()')
  })
})
