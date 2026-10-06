/**
 * Statuses a club may decline from (application-feedback mode 'decline').
 * Anything else (offered, accepted, signed, withdrawn, …) is refused with
 * 409 invalid_status, and the UPDATE repeats the same allow-list so a status
 * change between the read and the write is never overwritten.
 */
export const DECLINABLE_STATUSES = ['pending', 'shortlisted', 'maybe', 'rejected', 'no_response'] as const

export function canDecline(status: unknown): boolean {
  return typeof status === 'string' && (DECLINABLE_STATUSES as readonly string[]).includes(status)
}

/** Cap on the number of entries kept from array inputs sent to an AI draft. */
export const DRAFT_ARRAY_CAP = 12
