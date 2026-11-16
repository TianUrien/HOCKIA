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
// Style: client/src/locales/glossary.md (neutral Latin American Spanish, no
// second-person verb forms, no generic masculine, doublets only for roles).

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
  'Find clubs hiring': 'Buscar clubes que incorporan',
  'Find players to recommend': 'Buscar jugadores/as para recomendar',
  'Find players for my team': 'Buscar jugadores/as para mi equipo',
  'Improve my club profile': 'Mejorar el perfil del club',
  'Find ambassadors': 'Buscar embajadores/as',
  'Improve my brand profile': 'Mejorar el perfil de la marca',
  'Find other officials': 'Buscar colegas de arbitraje',
  'Add an appointment': 'Agregar una designación',
  'Improve my umpire profile': 'Mejorar mi perfil de árbitro/a',
  'What can you do?': '¿Qué puede hacer Hockia AI?',
  // nl-search inline chips
  'Post an opportunity': 'Publicar una oportunidad',
  'how do I post an opportunity': '¿Cómo se publica una oportunidad?',
  'Back to top applicants': 'Volver a las mejores postulaciones',
  'show my best applicants': 'Ver las mejores postulaciones',
  'Show all open roles': 'Ver todas las oportunidades abiertas',
  'Show me all open coaching roles': 'Ver todas las oportunidades abiertas para cuerpos técnicos',
  'Show me all open roles for me': 'Ver todas las oportunidades abiertas para mí',
  // clarifying.ts option labels
  'Opportunities': 'Oportunidades',
  'Clubs': 'Clubes',
  'Coaches': 'Entrenadores/as',
  'Brands': 'Marcas',
  'Clubs hiring': 'Clubes que incorporan',
  'Players': 'Jugadores/as',
  'Player ambassadors': 'Embajadores/as',
  'Marketplace': 'Marketplace',
  // clarifying.ts routed queries
  'Find opportunities for my position': 'Buscar oportunidades para mi puesto',
  'Find coaches in my position': 'Buscar entrenadores/as de mi puesto',
  'Find brands': 'Buscar marcas',
  'Find opportunities for coaches': 'Buscar oportunidades para cuerpos técnicos',
  'Find clubs hiring head coaches': 'Buscar clubes que incorporan entrenador/a principal',
  'Find players for my staff': 'Buscar jugadores/as para mi plantel',
  'Find coaches with head-coach experience': 'Buscar entrenadores/as con experiencia como principal',
  'Find opportunities to post': 'Ayuda para publicar una oportunidad',
  'Find player ambassadors': 'Buscar embajadores/as entre jugadores/as',
  'Show me products': 'Ver productos',
  'Find players': 'Buscar jugadores/as',
}

/** Clarifying option descriptions. */
export const DESCRIPTION_ES: Record<string, string> = {
  'Open roles that match your position': 'Oportunidades abiertas para tu puesto',
  'Clubs that fit your level and category': 'Clubes acordes a tu nivel y categoría',
  'Coaches who work with your position': 'Cuerpos técnicos que trabajan con tu puesto',
  'Brands on Hockia': 'Marcas en Hockia',
  'Open coaching roles': 'Oportunidades abiertas para cuerpos técnicos',
  'Clubs looking for coaching staff': 'Clubes que buscan cuerpo técnico',
  'Players open to new teams': 'Jugadores/as disponibles para nuevos equipos',
  'Players open to joining a club': 'Jugadores/as disponibles para sumarse a un club',
  'Coaches with head-coach experience': 'Cuerpos técnicos con experiencia como principal',
  'Help posting a role': 'Ayuda para publicar una oportunidad',
  'Players who could represent your brand': 'Jugadores/as que podrían representar a la marca',
  'Clubs for sponsorships': 'Clubes para patrocinios',
  'Coaches on Hockia': 'Cuerpos técnicos en Hockia',
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
const CHIP_PATTERNS: { re: RegExp; es: (m: RegExpMatchArray) => string }[] = [
  { re: /^Show all (clubs|players|coaches|brands|umpires|profiles)$/, es: (m) => `Ver ${entityPluralEs(m[1])} sin filtros` },
  { re: /^Remove (Adult women|Adult men|Girls|Boys|Mixed) filter$/, es: (m) => `Quitar el filtro ${CATEGORY_DISPLAY_ES[m[1]]}` },
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
  return CANONICAL.get(norm(query)) ?? query
}

/** A chip label or chip query in Spanish; unknown text unchanged. */
export function chipTextEs(text: string): string {
  const hit = CHIP_ES[text]
  if (hit) return hit
  for (const p of CHIP_PATTERNS) {
    const m = text.match(p.re)
    if (m) return p.es(m)
  }
  return text
}

// ── Messages ───────────────────────────────────────────────────────────────

export const MESSAGE_ES: Record<string, string> = {
  "You've reached today's limit. Try again tomorrow.": 'Se alcanzó el límite de preguntas de hoy. Mañana se puede volver a preguntar.',
  "That still didn't go through. Let's try a simpler path.": 'Todavía no funcionó. Conviene probar un camino más simple.',
  'I had trouble completing that search. Want to try again or broaden it?': 'No se pudo completar la búsqueda. Se puede reintentar o ampliarla.',
  "Let's try a different angle. Pick one of these to keep going:": 'Probemos otro enfoque. Estas opciones permiten seguir:',
  "You don't have any open opportunities yet. Post one and applicants will start coming in.": 'Todavía no hay oportunidades abiertas publicadas. Al publicar una, empiezan a llegar postulaciones.',
  'I had trouble pulling your recruitment data just now. Try again in a moment.': 'No se pudieron cargar los datos de reclutamiento. Conviene reintentar en un momento.',
  'I had trouble loading open roles just now. Try again in a moment.': 'No se pudieron cargar las oportunidades abiertas. Conviene reintentar en un momento.',
  "The AI search is busy right now and I couldn't find a quick keyword match. Try again in a moment, or rephrase your search.": 'La búsqueda con IA está ocupada en este momento y no hubo coincidencias rápidas por palabra clave. Conviene reintentar en un momento o reformular la búsqueda.',
  'The AI search is busy right now. Here are some keyword matches in the meantime. Try again in a moment for the full AI response.': 'La búsqueda con IA está ocupada en este momento. Mientras tanto, estas son algunas coincidencias por palabra clave. En un momento se puede reintentar para la respuesta completa.',
  "I couldn't complete the full AI response and didn't find a quick match either.": 'No se pudo completar la respuesta con IA y tampoco hubo coincidencias rápidas.',
  "I couldn't complete the full AI response, but here are some relevant matches.": 'No se pudo completar la respuesta con IA, pero estas coincidencias pueden servir.',
  'Who would you like to look for?': '¿A quién buscar?',
  "Hey! I'm HOCKIA Assistant. I can help you discover players, coaches, clubs, and brands. Try asking something like 'Find U25 midfielders from the Netherlands'.": "¡Hola! Soy HOCKIA Assistant. Puedo ayudar a encontrar jugadores/as, entrenadores/as, clubes y marcas. Un ejemplo de pregunta: 'Buscar volantes sub-25 de Países Bajos'.",
  "I couldn't generate an answer. Try rephrasing your question.": 'No pude generar una respuesta. Conviene reformular la pregunta.',
  'There are no suggestions for this role yet. Hockia checks again tonight.': 'Todavía no hay sugerencias para esta oportunidad. Hockia vuelve a revisar esta noche.',
  'This role isn’t open any more, so I can’t answer about it. Ask me about other roles instead.': 'Esta oportunidad ya no está abierta, así que no puedo responder sobre ella. Se puede preguntar por otras oportunidades.',
  'I can’t answer about this role right now. Try again in a moment.': 'Por ahora no puedo responder sobre esta oportunidad. Conviene reintentar en un momento.',
  'I’m not sure about that one. The club can tell you best.': 'No tengo certeza sobre eso. El club puede responderlo mejor.',
  'Nobody is waiting for a reply.': 'No hay postulaciones esperando respuesta.',
  '1 applicant is waiting for your reply.': '1 postulación espera tu respuesta.',
  'I can’t summarise right now. Try again in a moment.': 'Por ahora no puedo resumir. Conviene reintentar en un momento.',
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
    es: (m) => `La búsqueda de oportunidades con Hockia AI llega pronto. Por ahora, todas las oportunidades abiertas están en /opportunities${m[1] === '.' ? '.' : '. El filtro de la parte superior permite ver las de cuerpos técnicos.'}`,
  },
  {
    re: /^Browsing products through Hockia AI is rolling out next\. For now visit the Marketplace at \/marketplace to see what brands have posted(\.|\. You can also add your own products from the brand dashboard\.)$/,
    es: (m) => `La búsqueda de productos con Hockia AI llega pronto. Por ahora, lo que publican las marcas está en el Marketplace, en /marketplace${m[1] === '.' ? '.' : '. Los productos propios se agregan desde el panel de la marca.'}`,
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
  'Understanding your question': 'Entendiendo la pregunta',
  'Matching team, position and passport': 'Comparando equipo, puesto y pasaporte',
  'Writing your answer': 'Escribiendo la respuesta',
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
