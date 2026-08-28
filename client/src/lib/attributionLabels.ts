/**
 * Display names for normalized attribution sources and groups (pure).
 * Anything not listed is title-cased from its slug; "referral:<host>"
 * shows the host.
 */

const SOURCE_LABEL: Record<string, string> = {
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  qr: 'QR code',
  chatgpt: 'ChatGPT',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  google_organic: 'Google (organic)',
  bing_organic: 'Bing (organic)',
  duckduckgo: 'DuckDuckGo',
  direct_app: 'Direct (app open)',
  apple_app_store: 'App Store',
  google_play: 'Google Play',
  play_install_referrer: 'Play install referrer',
}

export const GROUP_LABEL: Record<string, string> = {
  social: 'Social', search: 'Search', ai_assistant: 'AI assistants', messaging: 'Messaging',
  email: 'Email', qr: 'QR', offline: 'Offline', store: 'App stores', referral: 'Referral sites',
  direct: 'Direct', unknown: 'Unknown', other: 'Other', internal: 'Internal',
}

export function displaySource(source: string | null | undefined): string {
  if (!source) return '—'
  if (source.startsWith('referral:')) return source.slice('referral:'.length)
  return SOURCE_LABEL[source] ?? source.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function displayGroup(group: string | null | undefined): string {
  if (!group) return '—'
  return GROUP_LABEL[group] ?? group
}
