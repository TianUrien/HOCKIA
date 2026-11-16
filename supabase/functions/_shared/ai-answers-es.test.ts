/**
 * Stage 3: Hockia AI answers in the member's language.
 *
 * Pinned here: English prompts are byte-identical to the existing constants;
 * Spanish prompts carry the output-language rule; Spanish fixed text (canned
 * answers, chips, clarifying options, templates, labels) has no leftover
 * English; Spanish chip text routes back to the English query.
 */
import { assert, assertEquals, assertNotEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { runWithAiLanguage, SPANISH_OUTPUT_INSTRUCTION } from './ai-language.ts'
import { PROFILE_BIO_SYSTEM, profileBioSystem, validateBioDrafts } from './profile-bio.ts'
import { APPLY_NOTE_SYSTEM, applyNoteSystem, templateNote, templateNoteEs, templateNoteFor, type ApplyFacts, type RoleFacts } from './apply-note.ts'
import { ROLE_DESCRIPTION_SYSTEM, roleDescriptionSystem, template, templateEs, templateFor } from './role-description-copy.ts'
import { builderSteps, yearsLabel } from './profile-draft.ts'
import { BANNED_ES, clubFallbackMessageEs, fallbackMessageEs, FEEDBACK_SPANISH_RULE, humanizePositionEs, reasonCopyEs } from './application-feedback-es.ts'
import { labelFor, labelForInline, positionLabel, scrubInternalValues } from './display-labels.ts'
import { buildIneligibleMessage, buildNoOpportunitiesMessage, buildOpportunityMessage, describeRoleNoun, type OpportunityCriteria } from './opportunity-search.ts'
import { describeSoftening } from './geo-softening.ts'
import {
  buildRoleSummaryEs,
  canonicalQuery,
  CHIP_ES,
  chipTextEs,
  CTA_ES,
  DESCRIPTION_ES,
  localizeNlBody,
  MESSAGE_ES,
  messageEs,
  STEP_ES,
  stepLabelEs,
} from './nl-search-es.ts'
import {
  getGreetingActions,
  getNoResultsActions,
  getRepeatedSoftErrorActions,
  getSelfAdviceActions,
  getSoftErrorActions,
  type SuggestedAction,
} from './suggested-actions.ts'
import { detectClarifyingNeed } from './clarifying.ts'
import { HOCKIA_FEATURES } from './hockia-features.ts'
import { stripClaims } from './role-ask.ts'
import { goalSummary } from './member-goal.ts'

/** Common English words that must not survive in Spanish fixed text. */
const ENGLISH = /\b(the|you|your|and|with|find|show|search|try|again|applied|applicants?|opportunit(y|ies)|players?|coaches|clubs|roles?|profile|improve|browse|what|who|here|found|there|couldn't|can't|not)\b/i
/** Proper nouns and product names that are the same in Spanish. */
const ALLOWED = /\b(Hockia AI|HOCKIA Assistant|Hockia|HOCKIA|Marketplace|CV)\b/g

function noEnglish(text: string, label: string) {
  const t = text.replace(ALLOWED, '').replace(/\/[a-z/]+/g, '')
  const hit = t.match(ENGLISH)
  assert(!hit, `${label}: leftover English "${hit?.[0]}" in: ${text}`)
}

const es = <T>(fn: () => T): T => runWithAiLanguage({ lang: 'es' }, fn)

// ── Prompts ────────────────────────────────────────────────────────────────

Deno.test('English prompts are the existing constants, unchanged', () => {
  assertEquals(profileBioSystem('en'), PROFILE_BIO_SYSTEM)
  assertEquals(profileBioSystem(), PROFILE_BIO_SYSTEM)
  assertEquals(applyNoteSystem('en'), APPLY_NOTE_SYSTEM)
  assertEquals(roleDescriptionSystem('en'), ROLE_DESCRIPTION_SYSTEM)
  // The "About the role" prompt moved out of index.ts verbatim.
  assertStringIncludes(ROLE_DESCRIPTION_SYSTEM, 'Write the team naturally, e.g. "a midfielder for our men\'s team", never "a Men midfielder".')
  assertEquals(ROLE_DESCRIPTION_SYSTEM.split('\n').length, 8)
})

Deno.test('Spanish prompts carry the output-language rule', () => {
  for (const [name, p] of [
    ['profile-bio', profileBioSystem('es')],
    ['apply-note', applyNoteSystem('es')],
    ['role-description', roleDescriptionSystem('es')],
  ] as const) {
    assertStringIncludes(p, SPANISH_OUTPUT_INSTRUCTION, name)
  }
  // profile-bio defaults to Spanish, not English, for a Spanish member.
  assertStringIncludes(profileBioSystem('es'), 'The language is Spanish unless')
  assert(!profileBioSystem('es').includes('The language is English unless'))
  // apply-note greets in Spanish.
  assertStringIncludes(applyNoteSystem('es'), 'Hola, <club>:')
  assertStringIncludes(FEEDBACK_SPANISH_RULE, SPANISH_OUTPUT_INSTRUCTION)
  assertStringIncludes(FEEDBACK_SPANISH_RULE, 'Esta vez no')
})

// ── Templates and fixed text ───────────────────────────────────────────────

const member: ApplyFacts = {
  firstName: 'Ana', role: 'player', position: 'midfielder', secondary: null,
  passports: [{ name: 'Italia', eu: true }], availableFrom: 'enero de 2027', currentClub: 'CASI',
  career: [], references: 0, hasVideo: false,
}
const role: RoleFacts = { club: 'Club Atlético Rosario', title: 'Volante de Primera', position: 'midfielder', euRequired: true, city: 'Rosario' }

Deno.test('apply-draft template in Spanish', () => {
  const t = templateNoteEs(member, role)
  assertEquals(t, 'Hola, Club Atlético Rosario: Mi puesto: Volante (CASI). Me interesa postularme a Volante de Primera. Tengo pasaporte de la UE (Italia). Tengo disponibilidad desde enero de 2027. Con gusto comparto más sobre mi hockey.')
  assertEquals(templateNoteFor(member, role, 'en'), templateNote(member, role))
  noEnglish(t.replace(/Club Atlético Rosario|CASI|Volante de Primera|Italia/g, ''), 'apply template')
})

Deno.test('role-description template in Spanish', () => {
  const a = { type: 'player', position: 'midfielder', team: "Women's", city: 'Rosario', start: '2027-01-01', duration: 'Full season', package: ['housing', 'flights'] }
  const t = templateEs(a, 'Club Atlético Rosario')
  assertEquals(t, 'Club Atlético Rosario busca volante para el equipo de Damas, con base en Rosario. La oportunidad es desde 2027-01-01 por toda la temporada. Ofrecemos alojamiento, pasajes. Nos interesa conocer tu temporada hasta ahora y tu disponibilidad.')
  assertEquals(templateFor(a, 'X', 'en'), template(a, 'X'))
  noEnglish(t.replace('Club Atlético Rosario', ''), 'role template')
  const coach = templateEs({ type: 'coach', position: 'head_coach', duration: '3 months' }, 'CASI')
  assertStringIncludes(coach, 'busca entrenador/a principal')
  assertStringIncludes(coach, 'por 3 meses')
})

Deno.test('profile-builder steps and years in Spanish', () => {
  const counts = { found: 3, proposed: 2, matched: 1, duplicates: 1, cv: true, videos: 2, pagesRead: 1, unreadPages: 2, photos: 3 }
  const steps = builderSteps(counts, 'es')
  assertEquals(steps.length, 8)
  for (const s of steps) noEnglish(s.replace(/\bCV\b/, ''), 'builder step')
  assertEquals(builderSteps(counts, 'en')[0], 'Found 3 clubs in what you sent')
  const c = { club_name: 'X', city: null, country: null, league: null, role: null, start_year: 2021, start_month: 5, end_year: null, end_month: null, current: true }
  assertEquals(yearsLabel(c, 'es'), 'may 2021 – Actualidad')
  assertEquals(yearsLabel(c), 'May 2021 – Present')
})

Deno.test('profile-bio: Spanish fallback angles and Spanish claims are dropped', () => {
  const ok = validateBioDrafts({ recommended_angle: '', recommended_bio: 'Juego de volante en CASI desde 2021.', other_angle: '', other_bio: 'Busco un club en Europa para la próxima temporada.' }, 'es')
  assertEquals(ok.map((d) => d.angle), ['Recomendado', 'Otro enfoque'])
  const bad = validateBioDrafts({ recommended_bio: 'Soy de clase mundial y lo garantizo.', other_bio: 'Juego de volante.' }, 'es')
  assertEquals(bad.length, 1)
  assertEquals(validateBioDrafts({ recommended_bio: 'I play midfield at CASI.', other_bio: 'x' }).map((d) => d.angle), ['Recommended', 'Another angle'])
})

Deno.test('application-feedback Spanish copy', () => {
  const reasons = ['position_filled', 'different_position', 'different_level', 'timing', 'location', 'eligibility', 'profile_incomplete', 'video_missing']
  for (const r of reasons) noEnglish(reasonCopyEs(r)!, `reason ${r}`)
  assertEquals(reasonCopyEs('other'), null)
  for (const status of ['shortlisted', 'maybe', 'rejected', 'pending']) {
    for (const reason of [null, 'timing']) {
      const m = fallbackMessageEs({ status, reason, position: 'Volante', clubName: 'CASI' })
      noEnglish(m.replace('CASI', ''), `fallback ${status}/${reason}`)
      for (const b of BANNED_ES) assert(!m.toLowerCase().includes(b), `${status} uses banned "${b}"`)
    }
  }
  for (const reason of [...reasons, null]) {
    const m = clubFallbackMessageEs({ status: 'rejected', reason, position: 'Volante', clubName: 'CASI' })
    noEnglish(m.replace('CASI', ''), `club fallback ${reason}`)
    assertStringIncludes(m, 'Esta vez no')
  }
  assertEquals(humanizePositionEs('goalkeeper'), 'Arquero/a')
  assertEquals(humanizePositionEs('some_thing'), 'Some Thing')
})

Deno.test('labels follow the request language; English outside a request', () => {
  assertEquals(labelFor('adult_women'), "Women's")
  assertEquals(es(() => labelFor('adult_women')), 'Damas')
  assertEquals(es(() => labelForInline('eu_passport')), 'pasaporte de la UE')
  assertEquals(es(() => positionLabel('goalkeeper')), 'Arquero/a')
  assertEquals(positionLabel('goalkeeper'), 'Goalkeeper')
  assertEquals(es(() => scrubInternalValues('Busco adult_men en open_to_play')), 'Busco caballeros en disponible para jugar')
  assertEquals(scrubInternalValues('wants adult_men'), "wants men's")
})

Deno.test('opportunity and softening messages in Spanish', () => {
  const crit: OpportunityCriteria = { opportunityType: 'player', positions: ['midfielder'], benefits: ['housing'], genders: ['Women'], countryNames: [], countryLabel: 'España', regionLabel: null }
  const msgs = es(() => [
    buildOpportunityMessage(3, crit, 'España'),
    buildOpportunityMessage(1, crit, null),
    buildNoOpportunitiesMessage(crit, 'España'),
    buildNoOpportunitiesMessage({ ...crit, positions: [], benefits: [], genders: [] }, null),
    buildIneligibleMessage(crit, 'España'),
    buildIneligibleMessage(crit, 'España', { count: 2, region: 'Europa' }),
    describeSoftening('region', { noun: 'clubes', nounSingular: 'club', count: 2, countryLabel: 'Chile', regionLabel: 'Sudamérica' }),
    describeSoftening('worldwide', { noun: 'clubes', count: 1, nounSingular: 'club', countryLabel: 'Chile' }),
    describeSoftening('city', { noun: 'clubes', count: 4, cityLabel: 'Rosario', countryLabel: 'Argentina' }),
  ])
  assertEquals(msgs[0], 'Hay 3 oportunidades de volante en Damas en España con alojamiento a las que es posible postularse.')
  for (const m of msgs) noEnglish(m.replace(/España|Europa|Chile|Sudamérica|Rosario|Argentina/g, ''), 'opportunity message')
  assertEquals(describeRoleNoun(crit, 'en').plural, "women's midfielder roles")
  assertEquals(buildOpportunityMessage(3, crit, 'Spain'), "I found 3 women's midfielder roles in Spain with housing you can apply to.")
})

// ── nl-search fixed text ───────────────────────────────────────────────────

Deno.test('every Spanish chip, message, step, CTA and description is free of English', () => {
  for (const [en, s] of Object.entries(CHIP_ES)) {
    assertNotEquals(s, en === 'Marketplace' ? '' : en, `chip "${en}" untranslated`)
    noEnglish(s, `chip "${en}"`)
  }
  for (const [en, s] of Object.entries(MESSAGE_ES)) noEnglish(s, `message "${en.slice(0, 40)}"`)
  for (const s of Object.values(STEP_ES)) noEnglish(s, 'step')
  for (const s of Object.values(CTA_ES)) noEnglish(s, 'cta')
  for (const s of Object.values(DESCRIPTION_ES)) noEnglish(s, 'description')
})

Deno.test('the whole chip catalog is covered in Spanish', () => {
  const all: SuggestedAction[] = [
    ...getSoftErrorActions(),
    ...getRepeatedSoftErrorActions(),
    ...['player', 'coach', 'club', 'brand', 'umpire', null].flatMap((r) => [...getSelfAdviceActions(r), ...getGreetingActions(r)]),
    ...(['clubs', 'players', 'coaches', 'brands', 'umpires'] as const).flatMap((entity) =>
      ['adult_women', 'adult_men', 'girls', 'boys', 'mixed', null].flatMap((category_label) =>
        getNoResultsActions({ entity, category_label, gender_label: null, location_label: null, role_summary: '' }, 'player').concat(
          getNoResultsActions({ entity, category_label, gender_label: null, location_label: null, role_summary: '' }, 'club'),
          getNoResultsActions({ entity, category_label, gender_label: null, location_label: null, role_summary: '' }, 'brand'),
        ))),
  ]
  for (const a of all) {
    const label = chipTextEs(a.label)
    assertNotEquals(label, a.label, `chip "${a.label}" has no Spanish`)
    noEnglish(label, `chip "${a.label}"`)
    if (a.intent.type === 'free_text') {
      const q = chipTextEs(a.intent.query)
      // The Spanish chip text routes back to the English query.
      assertEquals(canonicalQuery(q), a.intent.query, `chip query "${a.intent.query}" does not round-trip`)
    }
  }
})

Deno.test('clarifying options are covered and round-trip', () => {
  for (const role of ['player', 'coach', 'club', 'brand', null]) {
    const c = detectClarifyingNeed('Find people', role)!
    const body = localizeNlBody({ ai_message: c.message, clarifying_options: c.options }) as { ai_message: string; clarifying_options: { label: string; routed_query: string; description?: string }[] }
    assertEquals(body.ai_message, '¿A quién buscar?')
    body.clarifying_options.forEach((o, i) => {
      noEnglish(o.label, 'clarifying label')
      noEnglish(o.routed_query, 'clarifying query')
      if (o.description) noEnglish(o.description, 'clarifying description')
      assertEquals(canonicalQuery(o.routed_query), c.options[i].routed_query)
    })
  }
})

Deno.test('every feature CTA label has a Spanish version', () => {
  for (const f of HOCKIA_FEATURES) assert(CTA_ES[f.label], `CTA "${f.label}" has no Spanish`)
})

Deno.test('localizeNlBody swaps fixed strings only; model text, ids and kinds untouched', () => {
  const body = {
    success: true,
    kind: 'soft_error',
    ai_message: 'I had trouble completing that search. Want to try again or broaden it?',
    summary: 'Showing 3 keyword matches.',
    data: [{ id: 'p1', full_name: 'Ana' }],
    suggested_actions: [{ label: 'Retry', intent: { type: 'retry' } }, { label: 'Show all clubs', intent: { type: 'free_text', query: 'Show all clubs' } }],
    cta: { label: 'Browse all opportunities', route: '/opportunities' },
  }
  const out = localizeNlBody(body) as typeof body
  assertEquals(out.kind, 'soft_error')
  assertEquals(out.data, body.data)
  assertEquals(out.ai_message, 'No se pudo completar la búsqueda. Se puede reintentar o ampliarla.')
  assertEquals(out.summary, '3 coincidencias por palabra clave.')
  assertEquals(out.suggested_actions[0], { label: 'Reintentar', intent: { type: 'retry' } })
  assertEquals(out.suggested_actions[1], { label: 'Ver clubes sin filtros', intent: { type: 'free_text', query: 'Ver clubes sin filtros' } })
  assertEquals(out.cta, { label: 'Ver todas las oportunidades', route: '/opportunities' })
  // Model-written Spanish passes through.
  assertEquals(messageEs('Hay 3 clubes en España.'), 'Hay 3 clubes en España.')
  // The English input is not mutated.
  assertEquals(body.suggested_actions[0].label, 'Retry')
})

Deno.test('templated messages and steps', () => {
  assertEquals(messageEs("Since the clubes de Damas en España search didn't find anything, here are the next angles to try:"), 'Como la búsqueda de clubes de Damas en España no encontró nada, estas son otras opciones para probar:')
  assertEquals(messageEs('4 applicants are waiting for your reply.'), '4 postulaciones esperan tu respuesta.')
  noEnglish(messageEs('Searching opportunities through Hockia AI is rolling out next. For now you can browse all open opportunities at /opportunities. Switch the filter to coaching roles in the page header.'), 'canned opportunities')
  noEnglish(messageEs('Browsing products through Hockia AI is rolling out next. For now visit the Marketplace at /marketplace to see what brands have posted.'), 'canned products')
  assertEquals(stepLabelEs('Checked 1 open role'), '1 oportunidad abierta revisada')
  assertEquals(stepLabelEs('Checked 7 open roles'), '7 oportunidades abiertas revisadas')
  assertEquals(buildRoleSummaryEs({ entity: 'clubs', category_label: 'adult_women', location_label: 'España', age: { max: 20 } }), 'clubes de Damas sub-21 en España')
  assertEquals(canonicalQuery('  quitar el filtro damas '), 'Remove Adult women filter')
  assertEquals(canonicalQuery('Buscar volantes en España'), 'Buscar volantes en España')
})

Deno.test('role-ask strips Spanish scores and promises only for Spanish', () => {
  const t = 'Tu puesto coincide con el de la oportunidad. Tenés un 80% de probabilidad. Hay garantizado un lugar.'
  assertEquals(es(() => stripClaims(t)), 'Tu puesto coincide con el de la oportunidad.')
  assertEquals(stripClaims('Your position matches. You have a 90% chance.'), 'Your position matches.')
  assertEquals(es(() => stripClaims('La probabilidad de lluvia no importa acá.')), '')
})

Deno.test('member goal wording in Spanish matches the client labels', () => {
  assertEquals(goalSummary(['play_abroad', 'get_sponsor'], null, 'es'), 'Jugar en el exterior · Conseguir un sponsor')
  assertEquals(goalSummary(['play_abroad'], 'mi meta', 'en'), 'Play abroad · mi meta')
})
