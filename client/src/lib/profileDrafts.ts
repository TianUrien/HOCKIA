import { logger } from '@/lib/logger'
import { withoutSensitiveDraftFields } from '@/lib/draftPrivacy'

const PROFILE_DRAFT_PREFIX = 'profileDraft'

type StoredProfileDraft<T> = {
  data: Partial<T>
  updatedAt: string
  role: string
  userId: string
}

const hasWindow = () => typeof window !== 'undefined'

const buildKey = (userId: string, role: string) => `${PROFILE_DRAFT_PREFIX}:${role}:${userId}`

/** Restorable draft fields; personal details come from the profile instead (see draftPrivacy). */
export function loadProfileDraft<T extends object>(userId: string, role: string): Partial<T> | null {
  if (!hasWindow()) return null
  const key = buildKey(userId, role)
  const raw = window.localStorage.getItem(key)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<StoredProfileDraft<T>> | T
    const data = parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed
    if (!data || typeof data !== 'object') return null
    return withoutSensitiveDraftFields(data as T) as Partial<T>
  } catch (error) {
    logger.warn?.('Failed to parse profile draft. Clearing stored value.', error)
    window.localStorage.removeItem(key)
    return null
  }
}

export function saveProfileDraft<T extends object>(userId: string, role: string, data: T) {
  if (!hasWindow()) return
  const key = buildKey(userId, role)
  try {
    const payload: StoredProfileDraft<T> = {
      data: withoutSensitiveDraftFields(data) as Partial<T>,
      updatedAt: new Date().toISOString(),
      role,
      userId,
    }
    window.localStorage.setItem(key, JSON.stringify(payload))
  } catch (error) {
    logger.warn?.('Failed to persist profile draft', error)
  }
}

export function clearProfileDraft(userId: string, role: string) {
  if (!hasWindow()) return
  window.localStorage.removeItem(buildKey(userId, role))
}

export function clearAllProfileDraftsForUser(userId: string) {
  if (!hasWindow()) return
  const prefix = `${PROFILE_DRAFT_PREFIX}:`
  const suffix = `:${userId}`
  const keysToRemove: string[] = []

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key) continue
    if (key.startsWith(prefix) && key.endsWith(suffix)) {
      keysToRemove.push(key)
    }
  }

  keysToRemove.forEach((key) => window.localStorage.removeItem(key))
}

/**
 * Drafts that can hold personal details (date of birth, nationality, the
 * profile form, a role being posted). Cleared from this browser on sign-out,
 * so on a shared device an abandoned draft never stays for the next person
 * (CodeQL "clear-text storage", 2026-10-23).
 */
const PERSONAL_DRAFT_PREFIXES = [`${PROFILE_DRAFT_PREFIX}:`, 'hockia-onboarding-v2:', 'hockia-onboarding-draft:', 'vacancyDraft:']

export function clearPersonalDraftsOnDevice() {
  if (!hasWindow()) return
  const keys: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key && PERSONAL_DRAFT_PREFIXES.some((p) => key.startsWith(p))) keys.push(key)
  }
  keys.forEach((key) => window.localStorage.removeItem(key))
}
