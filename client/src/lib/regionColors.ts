/**
 * Continent chip colours on the Clubs (World) page. Every continent has its
 * own hue so they stay distinguishable; none is amber (amber = the viewer
 * must act). Asia uses brand purple, so Europe is rose, not purple.
 */
export const REGION_COLORS: Record<string, string> = {
  'South America': 'bg-blue-100 text-blue-700',
  'Europe': 'bg-rose-100 text-rose-700',
  'Oceania': 'bg-cyan-100 text-cyan-700',
  'North America': 'bg-green-100 text-green-700',
  'Asia': 'bg-hockia-soft text-hockia-primary',
  'Africa': 'bg-orange-100 text-orange-700',
}

export function regionColor(region: string): string {
  return REGION_COLORS[region] ?? 'bg-gray-100 text-gray-700'
}
