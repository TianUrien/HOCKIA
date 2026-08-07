/**
 * Metric explainers for the founder dashboard.
 *
 * Single source of truth for what every metric MEANS: definition, formula,
 * why it matters, industry benchmarks, and a plain-English interpretation of
 * the current value. Rendered by <InfoTip> next to each metric so the
 * dashboard is readable by founders/investors without analytics background.
 *
 * Benchmark bands are consensus heuristics for NICHE/PROFESSIONAL networks
 * (weekly-cadence products like HOCKIA), not entertainment feeds. Sources:
 * Lenny's Newsletter benchmark surveys, Sequoia/a16z engagement posts,
 * Mixpanel/Amplitude benchmark reports. They are deliberately round numbers.
 *
 * Definitions here MUST stay in sync with the SQL in
 * supabase/migrations/*_admin_engagement_overview.sql and
 * admin_get_command_center.
 */

export type BenchmarkTier = 'poor' | 'average' | 'good' | 'excellent'

export interface BenchmarkBand {
  /** Value is classified into the highest band whose min it reaches. */
  min: number
  tier: BenchmarkTier
  label: string
}

export interface MetricExplainer {
  title: string
  /** What the metric measures, in one plain sentence. */
  measures: string
  /** How it is calculated — the actual formula/definition used by HOCKIA. */
  formula: string
  /** Why a founder should care. */
  why: string
  /** Ascending benchmark bands; omit for absolute counts with no benchmark. */
  benchmarks?: BenchmarkBand[]
  /** Unit appended when describing the value ('%' or ''). */
  unit?: string
}

export const TIER_LABELS: Record<BenchmarkTier, string> = {
  poor: 'Weak',
  average: 'Average',
  good: 'Good',
  excellent: 'Excellent',
}

export const TIER_COLORS: Record<BenchmarkTier, string> = {
  poor: 'text-red-600',
  average: 'text-amber-600',
  good: 'text-emerald-600',
  excellent: 'text-emerald-700',
}

/** Classify a value against a metric's benchmark bands. */
export function classifyMetric(explainer: MetricExplainer, value: number): BenchmarkBand | null {
  if (!explainer.benchmarks?.length) return null
  let current: BenchmarkBand = explainer.benchmarks[0]
  for (const band of explainer.benchmarks) {
    if (value >= band.min) current = band
  }
  return current
}

export const METRIC_INFO = {
  dau: {
    title: 'Daily Active Users (DAU)',
    measures: 'How many distinct people used HOCKIA today.',
    formula: 'Users with any activity recorded today (opening the app, browsing, messaging). Test accounts excluded.',
    why: 'Shows the size of the daily habit. For a weekly-rhythm sport product, a low DAU with healthy WAU is normal — hockey life runs week to week, not hour to hour.',
  },
  wau: {
    title: 'Weekly Active Users (WAU)',
    measures: 'How many distinct people used HOCKIA in the last 7 days.',
    formula: 'Users with any activity in the last 7 days. Test accounts excluded.',
    why: 'The core engagement number for HOCKIA: matches, training and opportunities move weekly, so WAU captures the real habit loop.',
  },
  mau: {
    title: 'Monthly Active Users (MAU)',
    measures: 'How many distinct people used HOCKIA in the last 30 days.',
    formula: 'Users with any activity in the last 30 days. Test accounts excluded.',
    why: 'Measures total reach — everyone the product touches in a month. Growth work grows MAU; product work turns MAU into WAU.',
  },
  stickiness: {
    title: 'WAU / MAU (Stickiness)',
    measures: 'Of everyone active this month, how many came back within the last week.',
    formula: 'Weekly Active Users ÷ Monthly Active Users × 100.',
    why: 'Separates habit from reach. If everyone visited just once a month, random timing alone would give ~23% — anything well above that means a weekly habit exists.',
    unit: '%',
    benchmarks: [
      { min: 0, tier: 'poor', label: '<25%' },
      { min: 25, tier: 'average', label: '25–35%' },
      { min: 35, tier: 'good', label: '35–55%' },
      { min: 55, tier: 'excellent', label: '55%+' },
    ],
  },
  d7Retention: {
    title: 'Day-7 Retention',
    measures: 'Of people who signed up 1–2 weeks ago, how many returned in their second week.',
    formula: 'Signups from 8–14 days ago who were active again between day 7 and day 13 after signing up.',
    why: 'The single best early signal of product-market fit: do new members find enough value to come back after the first week?',
    unit: '%',
    benchmarks: [
      { min: 0, tier: 'poor', label: '<15%' },
      { min: 15, tier: 'average', label: '15–25%' },
      { min: 25, tier: 'good', label: '25–40%' },
      { min: 40, tier: 'excellent', label: '40%+' },
    ],
  },
  newUsers: {
    title: 'New Users',
    measures: 'How many people created a HOCKIA account in the selected period.',
    formula: 'Profiles created in the window. Test accounts excluded.',
    why: 'Pure growth, separated from engagement: this is the top of the funnel, before anyone has formed a habit.',
  },
  activation: {
    title: 'Activation Rate',
    measures: 'Of this period’s new signups, how many completed the minimum setup to become a usable member.',
    formula: 'New users who finished onboarding AND uploaded a profile photo AND (for players) set a position ÷ all new users in the period.',
    why: 'Signups without activation are empty shells — they can’t be discovered, matched, or contacted. This measures how well onboarding converts interest into a real member.',
    unit: '%',
    benchmarks: [
      { min: 0, tier: 'poor', label: '<30%' },
      { min: 30, tier: 'average', label: '30–50%' },
      { min: 50, tier: 'good', label: '50–70%' },
      { min: 70, tier: 'excellent', label: '70%+' },
    ],
  },
  profileCompletion: {
    title: 'Profile Completion',
    measures: 'How many of all members have a genuinely filled-out profile.',
    formula: 'Members with a profile photo AND a written bio ÷ all members.',
    why: 'Complete profiles are what make search, matching and Hockia AI valuable. Every recruiter who opens an empty profile is a lost connection.',
    unit: '%',
    benchmarks: [
      { min: 0, tier: 'poor', label: '<25%' },
      { min: 25, tier: 'average', label: '25–50%' },
      { min: 50, tier: 'good', label: '50–70%' },
      { min: 70, tier: 'excellent', label: '70%+' },
    ],
  },
  contributors: {
    title: 'Weekly Contributors',
    measures: 'How many people actively created something in the last 7 days — not just browsed.',
    formula: 'Distinct users who posted, uploaded a photo or video, commented, sent a message, or published an opportunity in the last 7 days.',
    why: 'Communities live on fresh content. Contributors are the engine; browsers are the audience. Both matter, but only contributors keep the feed alive.',
  },
  contributorShare: {
    title: 'Browsers vs Contributors',
    measures: 'What share of this week’s active users created content vs only consumed it.',
    formula: 'Weekly contributors ÷ Weekly Active Users × 100. The remainder are browsers.',
    why: 'The classic community rule of thumb is 90-9-1 (90% lurk, 9% engage, 1% create) — so even 10–20% contributors is healthy. Falling below ~10% means the feed depends on very few people.',
    unit: '%',
    benchmarks: [
      { min: 0, tier: 'poor', label: '<10%' },
      { min: 10, tier: 'average', label: '10–20%' },
      { min: 20, tier: 'good', label: '20–35%' },
      { min: 35, tier: 'excellent', label: '35%+' },
    ],
  },
  contentCreation: {
    title: 'Content Created (7 days)',
    measures: 'How much fresh content the community produced this week.',
    formula: 'Photos, videos, posts and opportunities created in the last 7 days. Test accounts excluded.',
    why: 'Fresh content is what members come back to see. A quiet week here usually shows up as a WAU dip a week later.',
  },
  viewToApply: {
    title: 'View-to-Apply Conversion',
    measures: 'Of opportunity page views, how many turned into applications.',
    formula: 'Applications in the period ÷ opportunity views in the period × 100.',
    why: 'Measures whether the marketplace actually converts interest into action — the quality of both the opportunities and the application flow.',
    unit: '%',
    benchmarks: [
      { min: 0, tier: 'poor', label: '<5%' },
      { min: 5, tier: 'average', label: '5–15%' },
      { min: 15, tier: 'good', label: '15–25%' },
      { min: 25, tier: 'excellent', label: '25%+' },
    ],
  },
  playersContacted: {
    title: 'Players Contacted by Clubs',
    measures: 'How many players a club or coach reached out to first, in the period.',
    formula: 'Conversations started in the window where a club/coach sent the first message to a player.',
    why: 'This is HOCKIA doing its job: recruiters finding players worth talking to. It’s demand-side proof that profiles have real value.',
  },
  applications: {
    title: 'Applications Submitted',
    measures: 'How many opportunity applications players and coaches sent in the period.',
    formula: 'Applications created in the window (both sides non-test).',
    why: 'Supply-side proof: members trust the marketplace enough to raise their hand for real positions.',
  },
  shortlists: {
    title: 'Shortlists',
    measures: 'How many applications clubs moved to their shortlist in the period.',
    formula: 'Applications whose status is “shortlisted”, last updated in the window.',
    why: 'A shortlist is a club saying “this could be our player.” It’s the strongest pre-hire signal the platform can measure.',
  },
  invites: {
    title: 'Club Invitations',
    measures: 'Invite links clubs created to bring their members onto HOCKIA, and how many people joined through them.',
    formula: 'Invite links created in the window; joins = total members who used them.',
    why: 'Clubs importing their real-world roster is the strongest retention loop HOCKIA has — whole teams arrive together.',
  },
  filled: {
    title: 'Opportunities Filled',
    measures: 'Positions that were filled — the end of the funnel HOCKIA exists to power.',
    formula: 'Opportunities closed with reason “filled” or explicitly marked filled via HOCKIA.',
    why: 'The ultimate north star: a real player in a real position. Everything else on this dashboard is upstream of this number.',
  },
} as const satisfies Record<string, MetricExplainer>

export type MetricKey = keyof typeof METRIC_INFO
