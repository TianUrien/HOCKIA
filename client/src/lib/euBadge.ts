/** Where the badge sits: `light` = #003399 on #E6EDFF (white tiles, panels); `photo` = white on blue 85 % (over photos only). */
export type EuBadgeSurface = 'light' | 'photo'

/** The EU badge classes per surface (foundations; design audit 2026-10-21 A10). Tokens only. */
export function euBadgeTone(surface: EuBadgeSurface): string {
  return surface === 'photo' ? 'bg-eu-solid text-white' : 'bg-eu-soft text-eu-ink'
}
