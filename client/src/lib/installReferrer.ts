/**
 * Google Play Install Referrer (attribution Phase 3) — JS side.
 *
 * Asks the local Android plugin ONCE per install for the referrer string
 * Play attached to the install, and hands it to the attribution engine.
 * iOS has no equivalent (App Store installs stay "direct_app" unless the
 * person visited the web first — the engine's snapshot handles that case).
 *
 * Contract: never throws, never blocks startup, never runs twice. A launch
 * where Play could not answer (service unavailable, sideloaded build)
 * leaves the flag unset so the next launch asks again; a definitive
 * answer — including "no referrer" — is remembered.
 */

import { Capacitor, registerPlugin } from '@capacitor/core'
import { recordInstallReferrerTouch } from '@/lib/attribution'
import { storageRead, storageWrite } from '@/lib/analyticsIdentity'
import { logger } from '@/lib/logger'

export interface InstallReferrerResult {
  available: boolean
  referrer?: string
  reason?: string
  referrerClickTimestampSeconds?: number
  installBeginTimestampSeconds?: number
  googlePlayInstantParam?: boolean
}

interface InstallReferrerPlugin {
  getReferrer(): Promise<InstallReferrerResult>
}

export const INSTALL_REFERRER_KEY = 'hockia_install_referrer_v1'
/** Play's own placeholder for organic installs — carries no campaign. */
const NO_CAMPAIGN = /^(utm_source=google-play&utm_medium=organic|utm_source=\(not%20set\)&utm_medium=\(not%20set\)|utm_source=\(not set\)&utm_medium=\(not set\))?$/i

const plugin = registerPlugin<InstallReferrerPlugin>('InstallReferrer')

/** Pure: which referrer strings carry a campaign worth recording. */
export function hasCampaign(referrer: string | undefined | null): boolean {
  return !!referrer && !NO_CAMPAIGN.test(referrer.trim())
}

export async function captureInstallReferrer(): Promise<InstallReferrerResult | null> {
  try {
    if (Capacitor.getPlatform() !== 'android') return null
    if (storageRead(INSTALL_REFERRER_KEY)) return null
    const result = await plugin.getReferrer()
    if (!result?.available) return result ?? null // ask again next launch
    const referrer = result.referrer ?? ''
    // Organic installs are recorded too (google_play / store), so the
    // report can tell "found us in the store" from "we don't know".
    recordInstallReferrerTouch(hasCampaign(referrer) ? referrer : 'utm_source=google-play&utm_medium=organic')
    storageWrite(INSTALL_REFERRER_KEY, JSON.stringify({ at: new Date().toISOString(), campaign: hasCampaign(referrer) }))
    return result
  } catch (err) {
    logger.warn('[installReferrer] capture failed', err)
    return null
  }
}
