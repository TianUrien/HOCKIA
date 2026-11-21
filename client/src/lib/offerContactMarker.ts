/**
 * The device-side marker behind a campaign's "contacted" count. Kept apart
 * from the rest of the offers code (no imports) so sign-out can clear it
 * without pulling that code into the start-up bundle.
 *
 * One marker per member and brand: a second account on the same device is
 * never credited with the first one's visit.
 */
const PREFIX = 'hockia-offer-contact'
export const OFFER_CONTACT_WINDOW_MS = 86_400_000

export interface OfferContactMarker { offerId: string; surface: string; at: number }

const key = (memberId: string, brandProfileId: string) => `${PREFIX}:${memberId}:${brandProfileId}`

export function writeOfferContact(memberId: string, brandProfileId: string, marker: OfferContactMarker): void {
  try { localStorage.setItem(key(memberId, brandProfileId), JSON.stringify(marker)) } catch { /* private mode */ }
}

/** Reads the marker and removes it: it is used once, fresh or not. */
export function takeOfferContact(memberId: string, brandProfileId: string, now: number = Date.now()): OfferContactMarker | null {
  try {
    const k = key(memberId, brandProfileId)
    const raw = localStorage.getItem(k)
    if (!raw) return null
    localStorage.removeItem(k)
    const v = JSON.parse(raw) as OfferContactMarker
    return now - v.at > OFFER_CONTACT_WINDOW_MS ? null : v
  } catch {
    return null
  }
}

/** Sign-out: forget every pending marker on this device. */
export function clearOfferContacts(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k)
    }
  } catch { /* private mode */ }
}
