import { Browser } from '@capacitor/browser'
import { IS_NATIVE } from '@/lib/isNative'

/**
 * Links from offers and products to a brand's store carry UTM tags, so the
 * brand sees Hockia traffic and sales in its own analytics (Google Analytics,
 * Shopify…). Brand evaluation 2026-11-07, P0. Tags the brand already set on the
 * link win; we only fill the ones that are missing.
 */
export type OutboundKind = 'offer' | 'product'

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

export function tagOutboundLink(url: string, kind: OutboundKind, campaign: string | null | undefined, surface: string): string {
  try {
    const u = new URL(url)
    const tags: Record<string, string> = {
      utm_source: 'hockia',
      utm_medium: kind,
      utm_campaign: slug(campaign ?? '') || kind,
      utm_content: surface,
    }
    for (const [k, v] of Object.entries(tags)) if (!u.searchParams.has(k)) u.searchParams.set(k, v)
    return u.href
  } catch {
    return url
  }
}

/** Open a store link outside the app (in-app browser on native). */
export async function openOutbound(url: string): Promise<void> {
  if (IS_NATIVE) await Browser.open({ url })
  else window.open(url, '_blank', 'noopener,noreferrer')
}
