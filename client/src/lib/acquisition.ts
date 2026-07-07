/**
 * Acquisition capture (P6) — answers "which channel brings users who
 * retain?", the campaign's most important budget question.
 *
 * FIRST-TOUCH wins: the first visit that carries any signal (utm_* params
 * or an external referrer) is stored in localStorage and never overwritten.
 * At signup it rides the auth metadata; onboarding persists it to the
 * profile once (only while acquisition_source is still NULL server-side).
 *
 * source resolution: utm_source > referrer hostname > 'direct'. Values are
 * length-capped — they end up in a jsonb column and admin tables.
 */

const STORAGE_KEY = 'hockia-acq'
const MAX_LEN = 120

export interface AcquisitionInfo {
  source: string
  medium?: string
  campaign?: string
  referrer?: string
  landing_path?: string
  captured_at: string
}

const clip = (v: string | null | undefined): string | undefined =>
  v ? v.slice(0, MAX_LEN) : undefined

export function captureAcquisition(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY)) return // first touch already stored

    const params = new URLSearchParams(window.location.search)
    const utmSource = clip(params.get('utm_source'))
    const referrer = document.referrer || ''
    let referrerHost: string | undefined
    try {
      referrerHost = referrer ? new URL(referrer).hostname : undefined
    } catch {
      referrerHost = undefined
    }
    // Internal navigation is not acquisition.
    if (referrerHost && referrerHost.endsWith('inhockia.com')) referrerHost = undefined

    // No signal at all → record 'direct' (still useful: it separates true
    // direct traffic from "we never measured"), but let a LATER visit with
    // real UTM params upgrade it — only a signal-bearing touch is final.
    const source = utmSource ?? referrerHost ?? 'direct'
    const info: AcquisitionInfo = {
      source,
      medium: clip(params.get('utm_medium')),
      campaign: clip(params.get('utm_campaign')),
      referrer: clip(referrerHost),
      landing_path: clip(window.location.pathname),
      captured_at: new Date().toISOString(),
    }
    if (source === 'direct') {
      // store under a soft key that a signal-bearing touch may replace
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(info))
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(info))
    }
  } catch {
    /* storage-disabled browsers just lose attribution */
  }
}

export function getAcquisition(): AcquisitionInfo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as AcquisitionInfo) : null
  } catch {
    return null
  }
}
