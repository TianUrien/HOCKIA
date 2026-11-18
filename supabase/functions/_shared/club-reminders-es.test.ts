/**
 * Stage 3: club reminders, their emails and the club-side pushes in Spanish.
 * English is pinned by club-reminders.test.ts / club-reminder-email.test.ts
 * (unchanged); here: the Spanish copy, Intl dates, and no leftover English.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  buildNewApplicationsPush,
  buildReminderNotification,
  type CandidateRow,
  closesChip,
  closesPhrase,
  closingSoonSubject,
  lastCallBody,
  lastCallSubject,
  namesPhrase,
  newApplicationsCopyFromMetadata,
  newApplicationsSubject,
  planPublisherReminders,
  reminderCopyFromMetadata,
  roleLine,
  shortDate,
  toApplicantItems,
  toItems,
  waitingLine,
  weekdayName,
} from './club-reminders.ts'
import { renderNewApplicationsEmail, renderReminderEmail } from './club-reminder-email.ts'
import { buildPushPayload, recruitingTitleEs } from '../send-push/push-payload.ts'

const PUB = '00000000-0000-4000-8000-0000000000aa'
const ROLE_A = '00000000-0000-4000-8000-0000000000b1'
const TZ = 'America/Argentina/Buenos_Aires'

let seq = 0
function row(over: Partial<CandidateRow> = {}): CandidateRow {
  seq += 1
  return {
    publisher_id: PUB,
    publisher_email: 'club@example.com',
    publisher_full_name: 'Club Atlético Rosario',
    publisher_role: 'club',
    publisher_country_code: 'AR',
    publisher_notify_applications: true,
    answered_last_24h: false,
    last_reminder_email_date: null,
    last_reminder_push_date: null,
    last_new_applications_email_at: null,
    application_id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    opportunity_id: ROLE_A,
    role_title: 'Primera división, volante',
    role_position: 'midfielder',
    org_name: 'Club Atlético Rosario',
    applicant_id: `10000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    applicant_full_name: 'Ana Pérez',
    applicant_avatar_url: null,
    applicant_role: 'player',
    applicant_position: 'midfielder',
    applicant_country: 'Argentina',
    applicant_is_blocked: false,
    applicant_frozen_minor_at: null,
    applicant_known_minor: false,
    applied_at: '2026-09-29T15:00:00Z',
    closes_at: '2026-10-13T08:00:00Z',
    fit_state: 'green',
    email_closing_soon_logged: false,
    email_last_call_logged: false,
    push_closing_soon_logged: false,
    push_last_call_logged: false,
    ...over,
  }
}

const AR_9AM = new Date('2026-10-09T12:05:00Z')
const CLOSES_SAT = '2026-10-10T08:00:00Z'

/** Common English words that must not survive in Spanish copy. */
const ENGLISH = /\b(the|you|your|and|with|applied|applicants?|waiting|closes?|review|tomorrow|today|players?|last day|more)\b/i

function noEnglish(text: string, label: string) {
  const hit = text.match(ENGLISH)
  assert(!hit, `${label}: leftover English "${hit?.[0]}" in: ${text}`)
}

Deno.test('Spanish dates and weekdays come from Intl', () => {
  assertEquals(weekdayName({ weekday: 5 }, 'es'), 'viernes')
  assertEquals(weekdayName({ weekday: 0 }, 'es'), 'domingo')
  assertEquals(shortDate({ day: 14, month: 10 }, 'es'), '14 oct')
  assertEquals(closesPhrase(0, { weekday: 5, day: 9, month: 10 }, 'es'), 'hoy')
  assertEquals(closesPhrase(1, { weekday: 6, day: 10, month: 10 }, 'es'), 'mañana')
  assertEquals(closesPhrase(4, { weekday: 2, day: 13, month: 10 }, 'es'), 'el martes')
  assertEquals(closesPhrase(9, { weekday: 0, day: 18, month: 10 }, 'es'), 'el 18 de octubre')
  // Chips keep the short date.
  assertEquals(closesChip(9, { weekday: 0, day: 18, month: 10 }, 'es'), 'Cierra el 18 oct')
  assertEquals(closesChip(4, { weekday: 2, day: 13, month: 10 }, 'es'), 'Cierra el martes')
  // English unchanged.
  assertEquals(weekdayName({ weekday: 5 }), 'Friday')
  assertEquals(closesChip(4, { weekday: 2, day: 13, month: 10 }), 'Closes Tuesday')
})

Deno.test('Spanish subjects, lines and names', () => {
  assertEquals(namesPhrase(['Ana', 'Ben', 'Caro'], 'es'), 'Ana y 2 más')
  assertEquals(namesPhrase(['Ana', 'Ben'], 'es'), 'Ana y Ben')
  // "y" becomes "e" before the sound i (not before "hie"/"hia").
  assertEquals(namesPhrase(['Ana', 'Inés'], 'es'), 'Ana e Inés')
  assertEquals(namesPhrase(['Juan', 'Ignacio'], 'es'), 'Juan e Ignacio')
  assertEquals(namesPhrase(['Ana', 'Hilda'], 'es'), 'Ana e Hilda')
  assertEquals(namesPhrase(['Ana', 'Iara'], 'es'), 'Ana y Iara')
  assertEquals(namesPhrase(['Ana', 'Hielo'], 'es'), 'Ana y Hielo')
  assertEquals(namesPhrase([null], 'es'), 'una persona')
  assertEquals(lastCallSubject([{ firstName: 'Ana' }], 'es'), 'Último día para responder a Ana')
  assertEquals(waitingLine(3, true, 'es'), '3 jugadores/as esperan tu respuesta')
  assertEquals(waitingLine(1, false, 'es'), '1 postulante espera tu respuesta')
  assertEquals(roleLine('player', 'midfielder', 'Argentina', 'es'), 'Jugador/a, Volante, Argentina')
  assertEquals(roleLine('coach', 'head_coach', null, 'es'), 'Entrenador/a, Entrenador/a principal')
  assertEquals(roleLine('player', 'midfielder', 'Argentina'), 'Player, Midfielder, Argentina')
  assertEquals(roleLine('player', 'midfielder', 'Netherlands', 'es'), 'Jugador/a, Volante, Países Bajos')
  assertEquals(roleLine('player', 'midfielder', 'Netherlands'), 'Player, Midfielder, Netherlands')
  const items = toApplicantItems([row()], TZ, 'es')
  assertEquals(newApplicationsSubject(items, 'es'), 'Ana se postuló a Primera división, volante')
  const pending = toItems([row({ closes_at: '2026-10-13T08:00:00Z' })], TZ, AR_9AM, 'es')
  assertEquals(closingSoonSubject(pending, true, 'es'), 'La postulación de Ana cierra el martes')
  const body = lastCallBody({ firstName: 'Ana', daysLeft: 1, appliedLocal: { weekday: 2, day: 29, month: 9 } as never }, 'es')
  assertStringIncludes(body, 'Ana se postuló el 29 de septiembre')
  for (const t of [body, closingSoonSubject(pending, true, 'es'), waitingLine(3, true, 'es')]) noEnglish(t, 'line')
})

Deno.test('Spanish reminder notifications (stored title/summary) have no English', () => {
  const lastCall = toItems([row({ closes_at: CLOSES_SAT })], TZ, AR_9AM, 'es')
  const n1 = buildReminderNotification('applicant_last_call', lastCall, lastCall, 'es')
  assertEquals(n1.title, 'Último día para responder a Ana')
  assertEquals(n1.summary, 'La postulación a Primera división, volante cierra mañana.')
  const pending = toItems([row(), row({ applicant_full_name: 'Ben Ruiz' })], TZ, AR_9AM, 'es')
  const n2 = buildReminderNotification('applicants_closing_soon', [], pending, 'es')
  assertEquals(n2.title, '2 jugadores/as esperan respuesta de Club Atlético Rosario')
  assertEquals(n2.summary, 'La postulación de Ana cierra el martes.')
  assertEquals(n2.metadata.title, n2.title)
  // Ids, kind and route are language-free.
  const en = buildReminderNotification('applicants_closing_soon', [], toItems([row(), row({ applicant_full_name: 'Ben Ruiz' })], TZ, AR_9AM), 'en')
  assertEquals(en.kind, n2.kind)
  assertEquals(en.target_url, n2.target_url)
  assertEquals(en.title, '2 players are waiting for Club Atlético Rosario')
  for (const t of [n1.title, n1.summary, n2.title, n2.summary]) noEnglish(t.replace('Club Atlético Rosario', ''), 'notification')
})

Deno.test('Spanish grouped new-applications push', () => {
  const items = toApplicantItems([row(), row({ applicant_full_name: 'Ben Ruiz' }), row({ applicant_full_name: 'Caro Díaz' })], TZ, 'es')
  const p = buildNewApplicationsPush(PUB, items, 'es')
  assertEquals(p.title, '3 postulaciones nuevas para Primera división, volante')
  assertEquals(p.summary, 'Ana y 2 más se postularon.')
  const one = buildNewApplicationsPush(PUB, items.slice(0, 1), 'es')
  assertEquals(one.summary, 'Toca para revisar la postulación.')
  assertEquals(p.record.kind, 'vacancy_application_received')
  assertEquals(newApplicationsCopyFromMetadata({}, 'es'), { title: 'Postulaciones nuevas', body: 'Tienes postulaciones nuevas esperando.' })
  assertEquals(reminderCopyFromMetadata('applicant_last_call', {}, 'es').body, 'Una postulación cierra mañana.')
  assertEquals(reminderCopyFromMetadata('applicant_last_call', {}).body, 'An application closes tomorrow.')
})

Deno.test('Spanish reminder plan: items carry Spanish role lines', () => {
  const plan = planPublisherReminders([row({ closes_at: CLOSES_SAT })], AR_9AM, 'es')
  assert(plan?.email)
  assertEquals(plan!.pending[0].roleLine, 'Jugador/a, Volante, Argentina')
})

Deno.test('Spanish emails: subject, body and footer in Spanish, html lang="es"', () => {
  const items = toApplicantItems([row(), row({ applicant_full_name: 'Ben Ruiz' })], TZ, 'es')
  const e1 = renderNewApplicationsEmail({ items, baseUrl: 'https://example.com', lang: 'es' })
  assertEquals(e1.subject, '2 postulaciones nuevas para Primera división, volante')
  assertStringIncludes(e1.html, '<html lang="es">')
  assertStringIncludes(e1.html, 'Encaje alto')
  assertStringIncludes(e1.text, 'Elige qué emails recibes en Ajustes → Notificaciones.')
  const text1 = e1.text.replace(/https?:\/\/\S+/g, '').replace(/Primera división, volante|Club Atlético Rosario|Ana Pérez|Ben Ruiz/g, '')
  noEnglish(text1, 'new applications email')

  const lastCall = toItems([row({ closes_at: CLOSES_SAT })], TZ, AR_9AM, 'es')
  const others = toItems([row({ applicant_full_name: 'Ben Ruiz' })], TZ, AR_9AM, 'es')
  const e2 = renderReminderEmail({ lastCall, closingSoon: others, pending: [...lastCall, ...others], baseUrl: 'https://example.com', lang: 'es' })
  assertEquals(e2.subject, 'Último día para responder a Ana')
  assertStringIncludes(e2.html, 'No encaja, con una nota amable')
  assertStringIncludes(e2.html, 'Cierran pronto')
  const text2 = e2.text.replace(/https?:\/\/\S+/g, '').replace(/Primera división, volante|Club Atlético Rosario|Ana Pérez|Ben Ruiz/g, '')
  noEnglish(text2, 'reminder email')

  const e3 = renderReminderEmail({ lastCall: [], closingSoon: others, pending: others, baseUrl: 'https://example.com', lang: 'es' })
  assertEquals(e3.subject, 'La postulación de Ben cierra el martes')
  noEnglish(e3.text.replace(/https?:\/\/\S+/g, '').replace(/Primera división, volante|Club Atlético Rosario|Ben Ruiz/g, ''), 'closing soon email')

  // English default unchanged in shape.
  const en = renderNewApplicationsEmail({ items: toApplicantItems([row()], TZ), baseUrl: 'https://example.com' })
  assertStringIncludes(en.html, '<html lang="en">')
  assertStringIncludes(en.html, 'Strong fit')
})

Deno.test('send-push: the application status names the Spanish position', () => {
  const es = buildPushPayload('vacancy_application_status', { status: 'rejected', club_name: 'CASI', position: 'midfielder' }, 'X', null, 'es')
  assertEquals(es.body, 'Esta vez no: tu postulación para Volante no avanzó.')
  const gk = buildPushPayload('vacancy_application_status', { status: 'maybe', club_name: 'CASI', position: 'goalkeeper' }, 'X', null, 'es')
  assertStringIncludes(gk.body, 'Arquero/a')
  // A generated headline ("Men's midfielder") still falls back to the position.
  const sl = buildPushPayload('vacancy_application_status', { status: 'shortlisted', club_name: 'CASI', position: 'midfielder', vacancy_title: "Men's midfielder" }, 'X', null, 'es')
  assertEquals(sl.body, 'Estás en consideración para Volante.')
  const en = buildPushPayload('vacancy_application_status', { status: 'rejected', club_name: 'CASI', position: 'head_coach' }, 'X')
  assertEquals(en.body, 'Not this time for Head Coach.')
})

Deno.test('send-push: recruiting_update rebuilt in Spanish from the stored English title', () => {
  const cases: [string, string, string][] = [
    ['invite_received', 'CASI invited you to apply', 'CASI te invitó a postularte'],
    ['invite_declined', 'Ana Pérez passed on your invite', 'Ana Pérez no aceptó tu invitación'],
    ['offer_received', 'CASI sent you an offer', 'CASI te envió una oferta'],
    ['offer_received', 'CASI updated its offer', 'CASI actualizó su oferta'],
    ['offer_withdrawn', 'The club withdrew its offer', 'El club retiró su oferta'],
    ['offer_accepted', 'Ana accepted your offer', 'Ana aceptó tu oferta'],
    ['offer_declined', 'The player declined your offer', 'No aceptaron tu oferta'],
    ['invite_received', 'A player invited you to apply', 'Te invitaron a postularte'],
    ['application_withdrawn', 'Ana withdrew their application', 'Ana retiró su postulación'],
    ['signing_marked', 'Confirm your signing with CASI', 'Confirma tu incorporación con CASI'],
    ['signing_undone', 'CASI undid the signing', 'CASI deshizo la incorporación'],
    ['signing_confirmed', 'Ana confirmed the signing', 'Ana confirmó la incorporación'],
    ['offer_expired', 'Your offer to a player expired', 'Venció tu oferta'],
    ['offer_expired', 'Your offer to Ana expired', 'Venció tu oferta a Ana'],
    ['signing_expired', 'Ana didn\'t confirm the signing in 14 days', 'Ana no confirmó la incorporación en 14 días'],
  ]
  for (const [event, stored, expected] of cases) {
    assertEquals(recruitingTitleEs(event, stored), expected)
    const p = buildPushPayload('recruiting_update', { event, title: stored, summary: 'Volante, Primera', target_url: '/messages/x' }, 'X', null, 'es')
    assertEquals(p.title, expected)
    assertEquals(p.body, 'Volante, Primera')
    // English keeps the stored text.
    assertEquals(buildPushPayload('recruiting_update', { event, title: stored, summary: 's' }, 'X').title, stored)
  }
  // Unknown event or unrecognised title → the generic Spanish title (never English); English keeps it as stored.
  assertEquals(recruitingTitleEs('something_new', 'CASI did a thing'), null)
  assertEquals(buildPushPayload('recruiting_update', { event: 'offer_received', title: 'Custom text' }, 'X', null, 'es').title, 'Novedad de incorporación')
  assertEquals(buildPushPayload('recruiting_update', { event: 'offer_received', title: 'Custom text' }, 'X').title, 'Custom text')
})
