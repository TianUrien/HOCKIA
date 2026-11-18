/**
 * The language a member reads Hockia in, for emails written on the server.
 *
 * Founder decision 2026-11-15: emails and pushes follow the member's
 * interface language (profiles.ui_language: 'en' | 'es' | NULL). NULL or
 * anything unknown reads as English.
 *
 * The column is added by migration 20261116100000_profile_ui_language.sql.
 * It is always read in its OWN query that fails to English (column missing,
 * RLS, network): adding it to an existing select list would make that query
 * fail before the migration is applied and the email would be lost. Same
 * pattern as send-push/index.ts.
 *
 * Spanish follows client/src/locales/glossary.md: neutral Latin American
 * Spanish, tú to the member, no generic masculine for people,
 * doublets only for role names.
 *
 * Pure apart from the two read helpers; unit-tested in member-language.test.ts.
 */

export type MemberLanguage = 'en' | 'es'

/** The stored interface language; anything else reads as English. */
export function languageOf(value: unknown): MemberLanguage {
  return value === 'es' ? 'es' : 'en'
}

/** The narrow client surface the read helpers use (a SupabaseClient fits). */
// deno-lint-ignore no-explicit-any
export type LanguageClient = { from: (table: string) => any }

/** One member's language. Any failure reads as English, with a warning. */
export async function readMemberLanguage(
  supabase: LanguageClient,
  profileId: string | null | undefined,
): Promise<MemberLanguage> {
  if (!profileId) return 'en'
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('ui_language')
      .eq('id', profileId)
      .maybeSingle()
    if (error) {
      console.warn('[member-language] ui_language read failed, using English:', error.message ?? error)
      return 'en'
    }
    return languageOf((data as { ui_language?: unknown } | null)?.ui_language)
  } catch (err) {
    console.warn('[member-language] ui_language read threw, using English:', err instanceof Error ? err.message : err)
    return 'en'
  }
}

/** Ids per `.in('id', ...)` request (keeps the URL short). */
export const LANGUAGE_READ_CHUNK = 100

/**
 * Many members' languages. Every id is in the map; ids not returned, or in a
 * chunk whose read failed, are English.
 */
export async function readMemberLanguages(
  supabase: LanguageClient,
  ids: string[],
): Promise<Map<string, MemberLanguage>> {
  const unique = [...new Set(ids.filter(Boolean))]
  const out = new Map<string, MemberLanguage>()
  for (const id of unique) out.set(id, 'en')
  for (let i = 0; i < unique.length; i += LANGUAGE_READ_CHUNK) {
    const chunk = unique.slice(i, i + LANGUAGE_READ_CHUNK)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, ui_language')
        .in('id', chunk)
      if (error) {
        console.warn('[member-language] ui_language batch read failed, using English:', error.message ?? error)
        continue
      }
      for (const row of (data ?? []) as Array<{ id: string; ui_language?: unknown }>) {
        if (out.has(row.id)) out.set(row.id, languageOf(row.ui_language))
      }
    } catch (err) {
      console.warn('[member-language] ui_language batch read threw, using English:', err instanceof Error ? err.message : err)
    }
  }
  return out
}

// ============================================================================
// Shared Spanish words (client/src/locales/es/enums.json)
// ============================================================================

const POSITION_ES: Record<string, string> = {
  goalkeeper: 'Arquero/a',
  defender: 'Defensor/a',
  midfielder: 'Volante',
  forward: 'Delantero/a',
  // Coach specialisations (enums.json coachSpecialization)
  head_coach: 'Entrenador/a principal',
  assistant_coach: 'Entrenador/a asistente',
  youth_coach: 'Entrenador/a de juveniles',
  goalkeeper_coach: 'Entrenador/a de arqueros/as',
  strength_conditioning: 'Preparador/a físico/a',
  performance_analyst: 'Analista de rendimiento',
  sports_scientist: 'Especialista en ciencias del deporte',
  other_coach: 'Entrenador/a',
}

/**
 * Reference relationship labels (free text stored in English, from the
 * client's AddReferenceModal options). Unknown values are shown as stored.
 */
const RELATIONSHIP_ES: Record<string, string> = {
  'academy coach': 'Entrenador/a de academia',
  'assistant coach i worked with': 'Entrenador/a asistente con quien trabajé',
  'assistant coach': 'Entrenador/a asistente',
  'athlete i coached': 'Deportista que entrené',
  'clinic / academy host': 'Sede de clínica o academia',
  'club captain': 'Capitán o capitana del club',
  'club coach': 'Entrenador/a del club',
  'club director': 'Dirección del club',
  'club i regularly officiated for': 'Club donde arbitro habitualmente',
  'club member': 'Integrante del club',
  'club umpire': 'Árbitro/a del club',
  'club': 'Club',
  'coach at matches i officiated': 'Entrenador/a en partidos que arbitré',
  'colleague': 'Colega',
  'development panel coach': 'Entrenador/a del panel de desarrollo',
  'equipment partner': 'Marca de equipamiento',
  'fellow coach': 'Colega del cuerpo técnico',
  'fellow umpire': 'Colega de arbitraje',
  'former athlete': 'Deportista que entrené antes',
  'former captain': 'Ex capitán o capitana',
  'former club': 'Ex club',
  'former coach': 'Ex entrenador/a',
  'former colleague': 'Ex colega',
  'former member': 'Ex integrante',
  'former teammate': 'Ex compañero/a de equipo',
  'head coach': 'Entrenador/a principal',
  'home club': 'Club de origen',
  'match umpire': 'Árbitro/a de partido',
  'mentee': 'Aprendiz',
  'mentor': 'Mentor/a',
  'opposing coach': 'Entrenador/a rival',
  'panel colleague': 'Colega de panel',
  'player': 'Jugador/a',
  'senior national player': 'Jugador/a de selección mayor',
  'senior umpire': 'Árbitro/a sénior',
  'sponsor': 'Sponsor',
  'team captain i officiated': 'Capitán o capitana de equipo en partidos que arbitré',
  'team captain': 'Capitán o capitana del equipo',
  'teammate': 'Compañero/a de equipo',
  'tournament coach': 'Entrenador/a de torneo',
  'tournament host club': 'Club sede del torneo',
  'tournament official': 'Oficial de torneo',
  'tournament umpire': 'Árbitro/a de torneo',
  'umpire assessor': 'Evaluador/a arbitral',
  'umpire mentor': 'Mentor/a arbitral',
  'umpiring partner': 'Pareja de arbitraje',
}

const ROLE_ES: Record<string, string> = {
  player: 'Jugador/a',
  coach: 'Entrenador/a',
  umpire: 'Árbitro/a',
  club: 'Club',
  brand: 'Marca',
  member: 'Integrante',
}

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Spanish "and": "e" before a word that starts with the sound i ("Ana e Inés", "e Hilario"), else "y" ("y Hielo", "y Iara"). */
export function spanishAnd(next: string): string {
  return /^h?[ií](?![aeouáéóú])/i.test(next.trim()) ? 'e' : 'y'
}

/** "a, b y c" with the y/e rule; one item as is. */
export function spanishList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  const last = items[items.length - 1]
  return `${items.slice(0, -1).join(', ')} ${spanishAnd(last)} ${last}`
}

/** The agreed Spanish word for a position token, or null when there is none. */
export function spanishPositionLabel(token: string | null | undefined): string | null {
  if (!token) return null
  return POSITION_ES[token.trim().toLowerCase()] ?? null
}

/**
 * A position token as shown in an email: English keeps the existing
 * "capitalise the first letter" behaviour; Spanish uses the agreed word and
 * falls back to the same capitalisation for unknown tokens.
 */
export function emailPositionLabel(token: string, lang: MemberLanguage = 'en'): string {
  if (lang === 'es') {
    const hit = spanishPositionLabel(token)
    if (hit) return hit
  }
  return capitalizeFirst(token.replace(/_/g, ' ').trim())
}

/** A reference relationship in the member's language; unknown values as stored. */
export function relationshipLabel(value: string | null | undefined, lang: MemberLanguage = 'en'): string {
  const v = value ?? ''
  if (lang !== 'es') return v
  return RELATIONSHIP_ES[v.trim().toLowerCase()] ?? v
}

/** A role token as shown in an email (same rules as emailPositionLabel). */
export function roleLabel(token: string, lang: MemberLanguage = 'en'): string {
  if (lang === 'es') {
    const hit = ROLE_ES[token.trim().toLowerCase()]
    if (hit) return hit
  }
  return capitalizeFirst(token)
}

// ============================================================================
// Footer copy shared by the code-built emails
// ============================================================================

/** HTML footer sentence + link label ("You're receiving this because you have a Hockia account."). */
export const FOOTER_ES = {
  reason: 'Este email te llega por tu cuenta en Hockia.',
  settings: 'Ajustes de notificaciones',
  /** Plain-text footer line before the settings URL ("Manage preferences: "). */
  manage: 'Ajustes de notificaciones: ',
} as const
