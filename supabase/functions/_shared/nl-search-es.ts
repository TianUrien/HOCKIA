// Hockia AI (nl-search) fixed text in Spanish (Stage 3, 2026-11-16).
//
// The English copy stays where it is, unchanged. For a Spanish reader the
// finished response body passes through `localizeNlBody`, which swaps the
// fixed English strings (canned answers, soft errors, chips, clarifying
// options, CTA labels) for their Spanish versions. Model-written text is
// already Spanish (the prompts carry the output-language rule) and is left
// alone: anything not in these tables passes through unchanged.
//
// Chips: a chip's `query` is sent back as the member's next message and shown
// in the chat bubble, so a Spanish chip sends Spanish text. `canonicalQuery`
// maps that text back to the English query the router and the regexes
// expect, so routing is identical in both languages.
//
// Style: client/src/locales/glossary.md (neutral Latin American Spanish, tú to
// the member, Hockia AI in the first person, no generic masculine, doublets
// only for roles). Chips are the member's own words (infinitive or first
// person: "¿Qué puedes hacer?").

// ── Words ──────────────────────────────────────────────────────────────────

export const ENTITY_ES: Record<string, { plural: string; singular: string }> = {
  clubs: { plural: 'clubes', singular: 'club' },
  players: { plural: 'jugadores/as', singular: 'jugador/a' },
  coaches: { plural: 'entrenadores/as', singular: 'entrenador/a' },
  brands: { plural: 'marcas', singular: 'marca' },
  umpires: { plural: 'árbitros/as', singular: 'árbitro/a' },
  profiles: { plural: 'perfiles', singular: 'perfil' },
}

/** "players" → "jugadores/as"; unknown nouns as given. */
export function entityPluralEs(noun: string): string {
  return ENTITY_ES[noun]?.plural ?? noun
}
export function entitySingularEs(noun: string): string {
  return ENTITY_ES[noun]?.singular ?? noun
}

/**
 * Position nouns as nl-search builds them in English chips (formatPosition,
 * lower-cased; opportunity_type as the fallback) → Spanish singular label and
 * plural. Used for chips built from a template and their way back.
 */
const POSITION_NOUN_ES: Record<string, { singular: string; plural: string }> = {
  goalkeeper: { singular: 'arquero/a', plural: 'arqueros/as' },
  defender: { singular: 'defensor/a', plural: 'defensores/as' },
  midfielder: { singular: 'volante', plural: 'volantes' },
  forward: { singular: 'delantero/a', plural: 'delanteros/as' },
  'head coach': { singular: 'entrenador/a principal', plural: 'entrenadores/as principales' },
  'assistant coach': { singular: 'entrenador/a asistente', plural: 'entrenadores/as asistentes' },
  'youth coach': { singular: 'entrenador/a de juveniles', plural: 'entrenadores/as de juveniles' },
  'goalkeeper coach': { singular: 'entrenador/a de arqueros/as', plural: 'entrenadores/as de arqueros/as' },
  'strength conditioning': { singular: 'preparador/a físico/a', plural: 'preparadores/as físicos/as' },
  'performance analyst': { singular: 'analista de rendimiento', plural: 'analistas de rendimiento' },
  'sports scientist': { singular: 'especialista en ciencias del deporte', plural: 'especialistas en ciencias del deporte' },
  'other coach': { singular: 'entrenador/a', plural: 'entrenadores/as' },
  player: { singular: 'jugador/a', plural: 'jugadores/as' },
  coach: { singular: 'entrenador/a', plural: 'entrenadores/as' },
}

function positionNounKey(noun: string): string {
  return noun.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ')
}

/** "midfielder" / "Head Coach" / "head_coach" → "volantes" / "entrenadores/as principales"; null when unknown. */
export function positionPluralEs(noun: string | null | undefined): string | null {
  if (!noun) return null
  return POSITION_NOUN_ES[positionNounKey(noun)]?.plural ?? null
}

/** "Midfielder" / "head_coach" → "volante" / "entrenador/a principal" (lower case, for running text); null when unknown. */
export function positionSingularEs(noun: string | null | undefined): string | null {
  if (!noun) return null
  return POSITION_NOUN_ES[positionNounKey(noun)]?.singular ?? null
}

function positionNounFromPluralEs(pluralEs: string): string | null {
  const k = pluralEs.trim().toLowerCase()
  for (const [en, v] of Object.entries(POSITION_NOUN_ES)) if (v.plural === k) return en
  return null
}

function positionNounFromSingularEs(singularEs: string): string | null {
  const k = singularEs.trim().toLowerCase()
  for (const [en, v] of Object.entries(POSITION_NOUN_ES)) if (v.singular === k) return en
  return null
}

/** A country's Spanish name from its ISO code ("NL" → "Países Bajos"); the stored name when unknown. */
export function countryNameEs(code: string | null | undefined, fallback: string): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return fallback
  try {
    return new Intl.DisplayNames(['es'], { type: 'region' }).of(code.toUpperCase()) ?? fallback
  } catch {
    return fallback
  }
}

/** Category display names (suggested-actions categoryDisplay). */
export const CATEGORY_DISPLAY_ES: Record<string, string> = {
  'Adult women': 'Damas',
  'Adult men': 'Caballeros',
  'Girls': 'Juveniles damas',
  'Boys': 'Juveniles caballeros',
  'Mixed': 'Mixto',
}

const CATEGORY_SUMMARY_ES: Record<string, string> = {
  adult_women: 'de Damas',
  adult_men: 'de Caballeros',
  girls: 'de Juveniles damas',
  boys: 'de Juveniles caballeros',
  mixed: 'mixtos',
}

/** Spanish role summary ("clubes de Damas en España"), mirrors buildRoleSummary. */
export function buildRoleSummaryEs(applied: {
  entity: string | null
  category_label?: string | null
  gender_label?: string | null
  location_label?: string | null
  age?: { min?: number; max?: number }
} | null): string {
  if (!applied?.entity) return 'perfiles'
  const parts: string[] = [entityPluralEs(applied.entity)]
  const cat = applied.category_label ?? (applied.gender_label === 'Women' ? 'adult_women' : applied.gender_label === 'Men' ? 'adult_men' : null)
  if (cat && CATEGORY_SUMMARY_ES[cat]) parts.push(CATEGORY_SUMMARY_ES[cat])
  if (applied.age?.max != null) parts.push(`sub-${applied.age.max + 1}`)
  if (applied.location_label) parts.push(`en ${applied.location_label}`)
  return parts.join(' ')
}

// ── Chips and queries (English → Spanish). Both labels and chip queries. ──

export const CHIP_ES: Record<string, string> = {
  // suggested-actions.ts
  'Search by country': 'Buscar por país',
  'Find opportunities': 'Buscar oportunidades',
  'Find coaches': 'Buscar entrenadores/as',
  'Find clubs': 'Buscar clubes',
  'Browse Marketplace': 'Ver el Marketplace',
  'Retry': 'Reintentar',
  'Broaden search': 'Ampliar la búsqueda',
  'Browse opportunities': 'Ver oportunidades',
  'Start over': 'Empezar de nuevo',
  'Search clubs': 'Ver clubes',
  'Try again': 'Intentar de nuevo',
  'Find clubs for me': 'Buscar clubes para mí',
  'Improve my profile': 'Mejorar mi perfil',
  'Find clubs hiring': 'Buscar clubes con oportunidades abiertas',
  'Find players to recommend': 'Buscar jugadores/as para recomendar',
  'Find players for my team': 'Buscar jugadores/as para mi equipo',
  'Improve my club profile': 'Mejorar el perfil de mi club',
  'Find ambassadors': 'Buscar embajadores/as',
  'Improve my brand profile': 'Mejorar el perfil de mi marca',
  'Find other officials': 'Buscar colegas de arbitraje',
  'Add an appointment': 'Agregar una designación',
  'Improve my umpire profile': 'Mejorar mi perfil de árbitro/a',
  'What can you do?': '¿Qué puedes hacer?',
  // nl-search inline chips
  'Post an opportunity': 'Publicar una oportunidad',
  'how do I post an opportunity': '¿Cómo publico una oportunidad?',
  'Back to top applicants': 'Volver a las mejores postulaciones',
  'show my best applicants': 'Ver las mejores postulaciones',
  'Show all open roles': 'Ver todas las oportunidades abiertas',
  'Show me all open coaching roles': 'Ver todas las oportunidades abiertas para entrenadores/as',
  'Show me all open roles for me': 'Ver todas las oportunidades abiertas para mí',
  // clarifying.ts option labels
  'Opportunities': 'Oportunidades',
  'Clubs': 'Clubes',
  'Coaches': 'Entrenadores/as',
  'Brands': 'Marcas',
  'Clubs hiring': 'Clubes con oportunidades abiertas',
  'Players': 'Jugadores/as',
  'Player ambassadors': 'Embajadores/as',
  'Marketplace': 'Marketplace',
  // clarifying.ts routed queries
  'Find opportunities for my position': 'Buscar oportunidades para mi posición',
  'Find coaches in my position': 'Buscar entrenadores/as de mi posición',
  'Find brands': 'Buscar marcas',
  'Find opportunities for coaches': 'Buscar oportunidades para entrenadores/as',
  'Find clubs hiring head coaches': 'Buscar clubes que buscan entrenador/a principal',
  'Find players for my staff': 'Buscar jugadores/as para mi plantel',
  'Find coaches with head-coach experience': 'Buscar entrenadores/as con experiencia como entrenador/a principal',
  'Find opportunities to post': 'Ayuda para publicar una oportunidad',
  'Find player ambassadors': 'Buscar embajadores/as entre jugadores/as',
  'Show me products': 'Ver productos',
  'Find players': 'Buscar jugadores/as',
}

/** Clarifying option descriptions. */
export const DESCRIPTION_ES: Record<string, string> = {
  'Open roles that match your position': 'Oportunidades abiertas para tu posición',
  'Clubs that fit your level and category': 'Clubes acordes a tu nivel y categoría',
  'Coaches who work with your position': 'Entrenadores/as que trabajan con tu posición',
  'Brands on Hockia': 'Marcas en Hockia',
  'Open coaching roles': 'Oportunidades abiertas para entrenadores/as',
  'Clubs looking for coaching staff': 'Clubes que buscan cuerpo técnico',
  'Players open to new teams': 'Jugadores/as disponibles para nuevos equipos',
  'Players open to joining a club': 'Jugadores/as disponibles para sumarse a un club',
  'Coaches with head-coach experience': 'Entrenadores/as con experiencia como entrenador/a principal',
  'Help posting a role': 'Ayuda para publicar una oportunidad',
  'Players who could represent your brand': 'Jugadores/as que podrían representar a tu marca',
  'Clubs for sponsorships': 'Clubes para patrocinios',
  'Coaches on Hockia': 'Entrenadores/as en Hockia',
  'Products on Hockia': 'Productos en Hockia',
}

/** CTA button labels (hockia-features.ts and nl-search). */
export const CTA_ES: Record<string, string> = {
  'Create opportunity': 'Crear oportunidad',
  'My posted opportunities': 'Mis oportunidades publicadas',
  'Browse opportunities': 'Ver oportunidades',
  'My applications': 'Mis postulaciones',
  'Go to Home feed': 'Ir a Inicio',
  'My Network': 'Mi red',
  'References': 'Referencias',
  'My Journey': 'Mi trayectoria',
  'My Media': 'Mi multimedia',
  'My dashboard': 'Mi panel',
  'Discover': 'Descubrir',
  'Community': 'Comunidad',
  'Browse all opportunities': 'Ver todas las oportunidades',
  'See all open roles': 'Ver todas las oportunidades abiertas',
}

/** Chip text whose English is built from a template. */
const CHIP_PATTERNS: { re: RegExp; es: (m: RegExpMatchArray) => string | null }[] = [
  { re: /^Show all (clubs|players|coaches|brands|umpires|profiles)$/, es: (m) => `Ver ${entityPluralEs(m[1])} sin filtros` },
  { re: /^Remove (Adult women|Adult men|Girls|Boys|Mixed) filter$/, es: (m) => `Quitar el filtro ${CATEGORY_DISPLAY_ES[m[1]]}` },
  // nl-search recruitment chips built from the position (null → left as is).
  { re: /^Find (.+?)s to invite$/, es: (m) => withPlural(m[1], (p) => `Buscar ${p} para invitar`) },
  { re: /^find me (.+?)s$/, es: (m) => withPlural(m[1], (p) => `Buscar ${p} para invitar`) },
  { re: /^Find (.+?)s outside this pipeline$/, es: (m) => withPlural(m[1], (p) => `Buscar ${p} fuera de estas postulaciones`) },
  { re: /^find (.+?)s$/, es: (m) => withPlural(m[1], (p) => `Buscar ${p} fuera de estas postulaciones`) },
  { re: /^Show (.+) applicants$/, es: (m) => withSingular(m[1], (s) => `Ver postulaciones de ${s}`) },
  { re: /^Show me applicants for my (.+) opening$/, es: (m) => withSingular(m[1], (s) => `Ver las postulaciones de mi oportunidad de ${s}`) },
]

function withPlural(noun: string, f: (pluralEs: string) => string): string | null {
  const p = positionPluralEs(noun)
  return p ? f(p) : null
}

function withSingular(noun: string, f: (singularEs: string) => string): string | null {
  const s = positionSingularEs(noun)
  return s ? f(s) : null
}

/** Spanish text of the template chips → the English query nl-search routes on. */
const CANONICAL_PATTERNS: { re: RegExp; en: (m: RegExpMatchArray) => string | null }[] = [
  { re: /^Buscar (.+) para invitar$/i, en: (m) => { const n = positionNounFromPluralEs(m[1]); return n ? `find me ${n}s` : null } },
  { re: /^Buscar (.+) fuera de estas postulaciones$/i, en: (m) => { const n = positionNounFromPluralEs(m[1]); return n ? `find ${n}s` : null } },
  { re: /^Ver (?:las )?postulaciones de (?:mi oportunidad de )?(.+)$/i, en: (m) => { const n = positionNounFromSingularEs(m[1]); return n ? `Show me applicants for my ${n} opening` : null } },
]

/** Spanish chip text → the English query the router expects. */
const CANONICAL: Map<string, string> = (() => {
  const m = new Map<string, string>()
  for (const [en, es] of Object.entries(CHIP_ES)) {
    const key = norm(es)
    // First English wins for shared Spanish text (labels that are not queries).
    if (!m.has(key)) m.set(key, en)
  }
  for (const entity of Object.keys(ENTITY_ES)) m.set(norm(`Ver ${entityPluralEs(entity)} sin filtros`), `Show all ${entity}`)
  for (const [en, es] of Object.entries(CATEGORY_DISPLAY_ES)) m.set(norm(`Quitar el filtro ${es}`), `Remove ${en} filter`)
  return m
})()

function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The English query for a Spanish chip text; anything else unchanged. */
export function canonicalQuery(query: string): string {
  const hit = CANONICAL.get(norm(query))
  if (hit) return hit
  const q = query.trim().replace(/\s+/g, ' ')
  for (const p of CANONICAL_PATTERNS) {
    const m = q.match(p.re)
    const en = m ? p.en(m) : null
    if (en) return en
  }
  return query
}

/** A chip label or chip query in Spanish; unknown text unchanged. */
export function chipTextEs(text: string): string {
  const hit = CHIP_ES[text]
  if (hit) return hit
  for (const p of CHIP_PATTERNS) {
    const m = text.match(p.re)
    const es = m ? p.es(m) : null
    if (es) return es
  }
  return text
}

// ── Messages ───────────────────────────────────────────────────────────────

export const MESSAGE_ES: Record<string, string> = {
  "You've reached today's limit. Try again tomorrow.": 'Llegaste al límite de preguntas de hoy. Intenta de nuevo mañana.',
  "That still didn't go through. Let's try a simpler path.": 'Sigue sin funcionar. Probemos un camino más simple.',
  'I had trouble completing that search. Want to try again or broaden it?': 'No pude completar la búsqueda. ¿Quieres intentarlo de nuevo o ampliarla?',
  "Let's try a different angle. Pick one of these to keep going:": 'Probemos otro enfoque. Elige una de estas opciones para seguir:',
  "You don't have any open opportunities yet. Post one and applicants will start coming in.": 'Todavía no tienes oportunidades abiertas. Cuando publiques una, pueden empezar a llegar postulaciones.',
  'I had trouble pulling your recruitment data just now. Try again in a moment.': 'No pude cargar tus datos de reclutamiento. Intenta de nuevo en un momento.',
  'I had trouble loading open roles just now. Try again in a moment.': 'No pude cargar las oportunidades abiertas. Intenta de nuevo en un momento.',
  "The AI search is busy right now and I couldn't find a quick keyword match. Try again in a moment, or rephrase your search.": 'La búsqueda con IA está ocupada en este momento y no encontré coincidencias rápidas por palabra clave. Intenta de nuevo en un momento o reformula tu búsqueda.',
  'The AI search is busy right now. Here are some keyword matches in the meantime. Try again in a moment for the full AI response.': 'La búsqueda con IA está ocupada en este momento. Mientras tanto, estas son algunas coincidencias por palabra clave. Intenta de nuevo en un momento para tener la respuesta completa.',
  "I couldn't complete the full AI response and didn't find a quick match either.": 'No pude completar la respuesta con IA y tampoco encontré coincidencias rápidas.',
  "I couldn't complete the full AI response, but here are some relevant matches.": 'No pude completar la respuesta con IA, pero estas coincidencias pueden servirte.',
  'Who would you like to look for?': '¿A quién quieres buscar?',
  "Hey! I'm HOCKIA Assistant. I can help you discover players, coaches, clubs, and brands. Try asking something like 'Find U25 midfielders from the Netherlands'.": '¡Hola! Soy Hockia AI. Puedo ayudarte a encontrar jugadores/as, entrenadores/as, clubes y marcas. Prueba con algo como "volantes sub-25 de Países Bajos".',
  "I couldn't generate an answer. Try rephrasing your question.": 'No pude generar una respuesta. Intenta reformular tu pregunta.',
  'There are no suggestions for this role yet. Hockia checks again tonight.': 'Todavía no hay sugerencias para esta oportunidad. Hockia vuelve a revisar esta noche.',
  'This role isn’t open any more, so I can’t answer about it. Ask me about other roles instead.': 'Esta oportunidad ya no está abierta, así que no puedo responder sobre ella. Pregúntame por otras oportunidades.',
  'I can’t answer about this role right now. Try again in a moment.': 'Por ahora no puedo responder sobre esta oportunidad. Intenta de nuevo en un momento.',
  'I’m not sure about that one. The club can tell you best.': 'No tengo certeza sobre eso. El club puede responderte mejor.',
  'Nobody is waiting for a reply.': 'No hay postulaciones esperando respuesta.',
  '1 applicant is waiting for your reply.': '1 postulación espera tu respuesta.',
  'I can’t summarise right now. Try again in a moment.': 'Por ahora no puedo resumir. Intenta de nuevo en un momento.',
}

const MESSAGE_PATTERNS: { re: RegExp; es: (m: RegExpMatchArray) => string }[] = [
  {
    re: /^(\d+) applicants are waiting for your reply\.$/,
    es: (m) => `${m[1]} postulaciones esperan tu respuesta.`,
  },
  {
    re: /^Since the (.+) search didn't find anything, here are the next angles to try:$/,
    es: (m) => `Como la búsqueda de ${m[1]} no encontró nada, estas son otras opciones para probar:`,
  },
  {
    re: /^Searching opportunities through Hockia AI is rolling out next\. For now you can browse all open opportunities at \/opportunities(\.|\. Switch the filter to coaching roles in the page header\.)$/,
    es: (m) => `La búsqueda de oportunidades con Hockia AI llega pronto. Por ahora, puedes ver todas las oportunidades abiertas en /opportunities${m[1] === '.' ? '.' : '. Cambia el filtro de la parte superior a oportunidades para entrenadores/as.'}`,
  },
  {
    re: /^Browsing products through Hockia AI is rolling out next\. For now visit the Marketplace at \/marketplace to see what brands have posted(\.|\. You can also add your own products from the brand dashboard\.)$/,
    es: (m) => `La búsqueda de productos con Hockia AI llega pronto. Por ahora, visita el Marketplace en /marketplace para ver lo que publicaron las marcas${m[1] === '.' ? '.' : '. También puedes agregar tus propios productos desde el panel de tu marca.'}`,
  },
  {
    re: /^Showing (\d+) keyword match(es)?\.$/,
    es: (m) => `${m[1]} ${m[1] === '1' ? 'coincidencia' : 'coincidencias'} por palabra clave.`,
  },
]

/** A fixed English message in Spanish; model-written or unknown text unchanged. */
export function messageEs(text: string): string {
  const hit = MESSAGE_ES[text]
  if (hit) return hit
  for (const p of MESSAGE_PATTERNS) {
    const m = text.match(p.re)
    if (m) return p.es(m)
  }
  return text
}

// ── Live step labels (Hockia AI sheet) ─────────────────────────────────────

export const STEP_ES: Record<string, string> = {
  'Understanding your question': 'Entendiendo tu pregunta',
  'Matching team, position and passport': 'Comparando equipo, posición y pasaporte',
  'Writing your answer': 'Escribiendo tu respuesta',
  'Reading this role': 'Leyendo esta oportunidad',
  'Read this role': 'Oportunidad leída',
  'Checking your profile': 'Revisando tu perfil',
  'Checked your profile': 'Perfil revisado',
  'Writing the answer': 'Escribiendo la respuesta',
  'Wrote the answer': 'Respuesta lista',
  'Reading your profile': 'Leyendo tu perfil',
  'Read your profile': 'Perfil leído',
  'Looking up how Hockia works': 'Buscando cómo funciona Hockia',
  'Searching profiles': 'Buscando perfiles',
  'Searched profiles': 'Perfiles revisados',
}

export function stepLabelEs(label: string): string {
  const hit = STEP_ES[label]
  if (hit) return hit
  const m = label.match(/^Checked (\d+) open roles?$/)
  if (m) return m[1] === '1' ? '1 oportunidad abierta revisada' : `${m[1]} oportunidades abiertas revisadas`
  return label
}

// ── The response body ──────────────────────────────────────────────────────

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

function localizeAction(a: unknown): unknown {
  if (!isObj(a)) return a
  const out: Obj = { ...a }
  if (typeof out.label === 'string') out.label = chipTextEs(out.label)
  if (isObj(out.intent) && out.intent.type === 'free_text' && typeof out.intent.query === 'string') {
    out.intent = { ...out.intent, query: chipTextEs(out.intent.query) }
  }
  return out
}

function localizeOption(o: unknown): unknown {
  if (!isObj(o)) return o
  const out: Obj = { ...o }
  if (typeof out.label === 'string') out.label = chipTextEs(out.label)
  if (typeof out.routed_query === 'string') out.routed_query = chipTextEs(out.routed_query)
  if (typeof out.description === 'string') out.description = DESCRIPTION_ES[out.description] ?? out.description
  return out
}

/**
 * The nl-search JSON body for a Spanish reader. Only fixed English strings
 * are replaced; ids, kinds, routes, data rows and model text are untouched.
 */
export function localizeNlBody(body: unknown): unknown {
  if (!isObj(body)) return body
  const out: Obj = { ...body }
  if (typeof out.ai_message === 'string') out.ai_message = messageEs(out.ai_message)
  if (typeof out.summary === 'string') out.summary = messageEs(out.summary)
  if (Array.isArray(out.suggested_actions)) out.suggested_actions = out.suggested_actions.map(localizeAction)
  if (Array.isArray(out.chips)) out.chips = out.chips.map(localizeAction)
  for (const key of ['options', 'clarifying_options']) {
    if (Array.isArray(out[key])) out[key] = (out[key] as unknown[]).map(localizeOption)
  }
  if (isObj(out.clarifying)) {
    const c: Obj = { ...out.clarifying }
    if (typeof c.message === 'string') c.message = messageEs(c.message)
    if (Array.isArray(c.options)) c.options = c.options.map(localizeOption)
    out.clarifying = c
  }
  if (isObj(out.cta) && typeof out.cta.label === 'string') {
    out.cta = { ...out.cta, label: CTA_ES[out.cta.label] ?? out.cta.label }
  }
  return out
}
