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

/** Sources that mean "no channel" — never a winner, always grey. */
export const NON_CHANNEL_COLORS: Record<string, string> = { direct: '#9ca3af', direct_app: '#6b7280', unknown: '#d1d5db' }
const SOURCE_PALETTE = ['#6d28d9', '#2563eb', '#059669', '#d97706', '#e11d48', '#0891b2', '#65a30d', '#db2777', '#4f46e5', '#0d9488']

export function isNonChannel(source: string): boolean {
  return source in NON_CHANNEL_COLORS
}

/**
 * Stable colours for a set of sources: non-channels grey, identified sources
 * take palette colours in the order given (rank them first for a legend).
 */
export function colorForSources(sources: string[]): (source: string) => string {
  const identified = sources.filter((s) => !isNonChannel(s))
  return (source) => NON_CHANNEL_COLORS[source] ?? SOURCE_PALETTE[Math.max(0, identified.indexOf(source)) % SOURCE_PALETTE.length]
}

export function displayGroup(group: string | null | undefined): string {
  if (!group) return '—'
  return GROUP_LABEL[group] ?? group
}
