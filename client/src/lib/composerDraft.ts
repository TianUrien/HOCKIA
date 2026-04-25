/**
 * Composer draft persistence
 *
 * Keeps the post composer's text content alive across modal close, tab
 * switch, and accidental dismissal — the single most common "I lost what
 * I was writing" friction point in the post-creation flow.
 *
 * Scope (intentionally small for v1):
 *   - Saves only the text content. Selected club / selected person /
 *     uploaded media are not persisted (much more state to reconcile and
 *     the durable upload manager already covers in-progress uploads).
 *   - Drafts are scoped per user + per mode (post vs transfer) so a
 *     player switching between modes doesn't clobber either draft.
 *   - sessionStorage, not localStorage: drafts shouldn't outlive a
 *     browser session and we don't want stale drafts hanging around for
 *     weeks.
 *   - Edit-existing-post flow (isEdit=true) intentionally bypasses
 *     drafts — the editing UI loads the post's stored content and
 *     should not be polluted by a separate draft.
 */

const KEY_PREFIX = 'hockia-composer-draft'

export type ComposerMode = 'post' | 'transfer'

function storageKey(userId: string, mode: ComposerMode): string {
  return `${KEY_PREFIX}:${userId}:${mode}`
}

export function getDraft(userId: string | undefined, mode: ComposerMode): string {
  if (!userId || typeof window === 'undefined') return ''
  try {
    return sessionStorage.getItem(storageKey(userId, mode)) ?? ''
  } catch {
    return ''
  }
}

export function saveDraft(
  userId: string | undefined,
  mode: ComposerMode,
  content: string,
): void {
  if (!userId || typeof window === 'undefined') return
  try {
    if (content.trim().length === 0) {
      sessionStorage.removeItem(storageKey(userId, mode))
    } else {
      sessionStorage.setItem(storageKey(userId, mode), content)
    }
  } catch {
    // sessionStorage full or blocked — drafts degrade gracefully
  }
}

export function clearDraft(userId: string | undefined, mode: ComposerMode): void {
  if (!userId || typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(storageKey(userId, mode))
  } catch {
    // ignore
  }
}
