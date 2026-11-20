/**
 * The founder-approved text of /about and /faq (approved 2026-11-20; draft
 * in the description of PR 576). One source for the React pages, the server
 * body for crawlers without JavaScript and the FAQPage JSON-LD, so the three
 * cannot drift. Public Hockia copy is English only.
 *
 * The answer about countries is the one computed part: the number is read
 * from the world directory each time, never hand-written, and the "every
 * week" clause is dropped when the directory does not support it.
 *
 * Pure: no DOM and no network here, so it is unit-tested.
 */
import { escapeHtml, jsonForScript } from './opportunityHead'

/** What the world directory says right now. */
export interface DirectoryFacts {
  /** Countries with at least one club; null when it could not be read. */
  countries: number | null
  /** At least one club was added in each of the last WEEKS_CHECKED weeks. */
  addedEveryWeek: boolean
}

export const UNKNOWN_FACTS: DirectoryFacts = { countries: null, addedEveryWeek: false }
export const WEEKS_CHECKED = 4
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** The last WEEKS_CHECKED seven-day windows ending at `now`, newest first. */
export function weekWindows(now: Date): { from: string; to: string }[] {
  return Array.from({ length: WEEKS_CHECKED }, (_, i) => ({
    from: new Date(now.getTime() - (i + 1) * WEEK_MS).toISOString(),
    to: new Date(now.getTime() - i * WEEK_MS).toISOString(),
  }))
}

/** Facts from the two reads; any failed read gives the unknown facts. */
export function directoryFacts(clubsPerCountry: (number | null)[] | null, clubsAddedPerWeek: (boolean | null)[]): DirectoryFacts {
  if (!clubsPerCountry) return UNKNOWN_FACTS
  const countries = clubsPerCountry.filter((n) => (n ?? 0) > 0).length
  if (countries === 0) return UNKNOWN_FACTS
  return { countries, addedEveryWeek: clubsAddedPerWeek.length === WEEKS_CHECKED && clubsAddedPerWeek.every((w) => w === true) }
}

export function countriesAnswer(facts: DirectoryFacts): string {
  if (facts.countries === null || facts.countries <= 0) return 'Hockia is open worldwide.'
  const listed = `Hockia is open worldwide. The directory lists clubs in ${facts.countries} countries`
  return facts.addedEveryWeek ? `${listed}, and new clubs are added every week.` : `${listed}.`
}

export interface FaqItem {
  id: string
  question: string
  answer: string
}

export function faqItems(facts: DirectoryFacts): FaqItem[] {
  return [
    { id: 'what', question: 'What is Hockia?', answer: 'Hockia is the field hockey network: a place where players, coaches, clubs, umpires and brands have a profile, find each other and work together. It runs on the web at inhockia.com and as an app for iPhone and Android.' },
    { id: 'free', question: 'Is Hockia free?', answer: 'Yes. Creating a profile, browsing and applying to roles, and publishing roles as a club are free.' },
    { id: 'who-for', question: 'Who is Hockia for?', answer: 'Field hockey players, coaches, clubs, umpires and brands, at any level and in any country.' },
    { id: 'clubs', question: 'How do clubs recruit on Hockia?', answer: "A club creates its profile, publishes an open role for a player or a coach with the location, dates and what it offers, and receives applications from members. The club reviews each applicant's profile and replies inside Hockia." },
    { id: 'abroad', question: 'Can I find a field hockey club abroad?', answer: 'Yes. The opportunities page lists open roles at clubs in other countries, with what each club offers (for example housing, flights or visa support when the club provides them). The world directory lists clubs and leagues by country.' },
    { id: 'countries', question: 'Which countries does Hockia cover?', answer: countriesAnswer(facts) },
    { id: 'apply', question: 'How do I apply for a role?', answer: 'Create a free profile, open the role and apply. The club sees your profile, playing or coaching history and references.' },
    { id: 'sport', question: 'Is Hockia for field hockey or ice hockey?', answer: 'Field hockey only.' },
    { id: 'app', question: 'How do I get the app?', answer: 'Hockia is on the App Store and Google Play, and works in any browser at inhockia.com.' },
    { id: 'who-runs', question: 'Who runs Hockia?', answer: 'Hockia was founded by Cristian Urien and is built by a small independent team of field hockey people.' },
  ]
}

/** /about shows the answers about Hockia itself, in this order; /faq shows all ten. */
const ABOUT_IDS = ['what', 'who-for', 'free', 'sport', 'app', 'who-runs']

export function aboutItems(facts: DirectoryFacts): FaqItem[] {
  const all = faqItems(facts)
  return ABOUT_IDS.map((id) => all.find((i) => i.id === id)).filter((i): i is FaqItem => Boolean(i))
}

export const ABOUT_HEADING = 'About Hockia'
export const FAQ_HEADING = 'Frequently asked questions'

const LINKS =
  '<p><a href="/about">About Hockia</a> | <a href="/faq">Frequently asked questions</a> | <a href="/opportunities">Open field hockey roles</a> | ' +
  '<a href="/world">Field hockey clubs by country</a> | <a href="/community">Community</a> | <a href="/signup">Join Hockia free</a></p>'

function itemsHtml(items: FaqItem[]): string {
  return items.map((i) => `<h2>${escapeHtml(i.question)}</h2>\n<p>${escapeHtml(i.answer)}</p>`).join('\n')
}

/** Body of /faq and /about for crawlers without JavaScript. */
export function faqBody(facts: DirectoryFacts): string {
  return [`<h1>${FAQ_HEADING}</h1>`, itemsHtml(faqItems(facts)), LINKS].join('\n')
}

export function aboutBody(facts: DirectoryFacts): string {
  return [`<h1>${ABOUT_HEADING}</h1>`, itemsHtml(aboutItems(facts)), LINKS].join('\n')
}

/** schema.org FAQPage: the same questions and answers as the page shows. */
export function faqJsonLd(facts: DirectoryFacts, siteUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url: `${siteUrl}/faq`,
    mainEntity: faqItems(facts).map((i) => ({ '@type': 'Question', name: i.question, acceptedAnswer: { '@type': 'Answer', text: i.answer } })),
  }
}

/** schema.org AboutPage pointing at the Organization the home page declares. No person fields. */
export function aboutJsonLd(siteUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    url: `${siteUrl}/about`,
    name: ABOUT_HEADING,
    about: { '@id': 'https://inhockia.com/#organization' },
  }
}

/** Adds one JSON-LD block to the head of a rendered page. */
export function injectJsonLd(html: string, data: Record<string, unknown>): string {
  return html.replace('</head>', () => `<script type="application/ld+json" data-server="1">${jsonForScript(data)}</script>\n</head>`)
}
