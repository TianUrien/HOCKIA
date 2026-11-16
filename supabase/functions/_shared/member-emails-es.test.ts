/**
 * Member emails in Spanish (founder decision 2026-11-15: emails follow the
 * member's interface language).
 *
 * Pinned here:
 *   1. Every code-built member email has a Spanish version with no leftover
 *      English words in its visible text, and keeps the data it carries
 *      (names, titles, URLs).
 *   2. English stays the default and unchanged (spot checks of the exact
 *      English strings the functions built before).
 *   3. renderTemplate picks the '<key>__es' row for Spanish, falls back to
 *      the English row (with English variables and footer) when it is
 *      missing, and never changes English output.
 *   4. The Spanish rows in migration 20261116120000 keep the English rows'
 *      block structure and variable names.
 */

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import * as app from './application-email.ts'
import * as fr from './friend-request-email.ts'
import * as rq from './reference-request-email.ts'
import * as rs from './reference-response-email.ts'
import * as rm from './reference-reminder-email.ts'
import * as md from './message-digest-email.ts'
import * as pv from './profile-views-email.ts'
import * as vc from './vacancy-email.ts'
import * as sg from './opportunity-suggestions.ts'
import { type ContentBlock, renderContentBlocks, renderTemplate } from './email-renderer.ts'
import type { MemberLanguage } from './member-language.ts'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Visible text: no tags, entities, URLs or the brand name. */
function visible(htmlOrText: string): string {
  return htmlOrText
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\bHockia( AI)?\b/g, ' ')
}

/** English words that must never reach a Spanish email's visible text. */
const ENGLISH = /\b(you|your|you're|the|and|view|new|request|requests|profile|application|applications|applicant|applicants|opportunity|opportunities|message|messages|settings|notification|receiving|hi|there|someone|review|open|see|week|people|person|reference|references|from|for|on|is|are|has|have|this|that|with|ask|wrote|position|location|relationship|manage|preferences|connection|player|club's|coach|waiting|days?|more|renew|closed|still|update|updates|shortlist|browse)\b/i

function assertNoEnglish(label: string, htmlOrText: string) {
  const m = visible(htmlOrText).match(ENGLISH)
  assert(!m, `${label}: English word "${m?.[0]}" in Spanish email:\n${visible(htmlOrText).replace(/\s+/g, ' ').slice(0, 600)}`)
}

const applicant: app.ApplicantData = {
  id: 'a1', username: 'ana', full_name: 'Ana Pérez', position: 'midfielder', secondary_position: 'goalkeeper',
  base_location: 'Rosario', avatar_url: null, is_test_account: false, role: 'player',
}
const opportunity: app.OpportunityData = { id: 'o1', title: 'Arquero/a 2027', club_id: 'c1' }
const requester = {
  id: 'r1', username: 'bea', full_name: 'Bea Ruiz', base_location: 'Córdoba', avatar_url: null,
  is_test_account: false, role: 'coach',
}
const endorser = { id: 'e1', username: 'eve', full_name: 'Eva Club', avatar_url: null, is_test_account: false, role: 'club' }
const conversations = [
  { conversation_id: 'c1', message_count: 1, sender_name: 'Dani Sosa', sender_avatar_url: null },
  { conversation_id: 'c2', message_count: 3, sender_name: 'Eva', sender_avatar_url: 'https://x.test/e.png' },
]
const vacancy: vc.VacancyRecord = {
  id: 'v1', club_id: 'c1', title: 'Volante 2027', position: 'midfielder', location_city: 'Rosario',
  location_country: 'Argentina', description: 'Buscamos volante.', status: 'open', opportunity_type: 'player',
}

// ── 1 + 2. Builders ────────────────────────────────────────────────────────

Deno.test('application email: Spanish has no English and keeps the data; English unchanged', () => {
  const html = app.generateEmailHtml(applicant, opportunity, 'es')
  const text = app.generateEmailText(applicant, opportunity, 'es')
  assertNoEnglish('application html', html)
  assertNoEnglish('application text', text)
  for (const s of [html, text]) {
    assertStringIncludes(s, 'Ana Pérez')
    assertStringIncludes(s, 'Arquero/a 2027')
    assertStringIncludes(s, 'Volante • Arquero/a')
    assertStringIncludes(s, '/dashboard/opportunities/o1/applicants')
  }
  assertStringIncludes(html, '<html lang="es">')
  assertEquals(app.applicantPositionsText(applicant), 'Midfielder • Goalkeeper')
  const en = app.generateEmailText(applicant, opportunity)
  assertStringIncludes(en, 'New application received on Hockia')
  assertStringIncludes(en, 'Position: Midfielder • Goalkeeper')
  assertStringIncludes(en, "You're receiving this because you're on Hockia.\nManage preferences: ")
})

Deno.test('friend request email: Spanish has no English and keeps the data', () => {
  const html = fr.generateEmailHtml(requester, 'es')
  const text = fr.generateEmailText(requester, 'es')
  assertNoEnglish('friend html', html)
  assertNoEnglish('friend text', text)
  assertStringIncludes(html, 'Bea Ruiz')
  assertStringIncludes(text, 'Bea Ruiz quiere sumarte a sus amistades en Hockia.')
  assertStringIncludes(html, 'Ver solicitud')
  assertNoEnglish('friend unnamed', fr.generateEmailText({ ...requester, full_name: null }, 'es'))
})

Deno.test('reference request email: Spanish translates the relationship and keeps the note', () => {
  const html = rq.generateEmailHtml(requester, 'Teammate', 'Gracias por todo', 'es')
  const text = rq.generateEmailText(requester, 'Teammate', 'Gracias por todo', 'es')
  assertNoEnglish('reference request html', html)
  assertNoEnglish('reference request text', text)
  assertStringIncludes(html, 'Compañero/a de equipo')
  assertStringIncludes(text, 'Relación: Compañero/a de equipo')
  assertStringIncludes(text, 'Mensaje: "Gracias por todo"')
  assertStringIncludes(rq.generateEmailText(requester, 'Teammate', null), 'Relationship: Teammate')
})

Deno.test('reference accepted email: Spanish has no English', () => {
  for (const note of ['Gran jugadora', null]) {
    const html = rs.generateAcceptedEmailHtml(endorser, 'Former Coach', note, 'es')
    const text = rs.generateAcceptedEmailText(endorser, 'Former Coach', note, 'es')
    assertNoEnglish('reference accepted html', html)
    assertNoEnglish('reference accepted text', text)
    assertStringIncludes(text, 'Eva Club te dio una referencia en Hockia')
    assertStringIncludes(text, 'Ex entrenador/a')
  }
  assertEquals(rs.referenceAcceptedSubject('Eva', 'es'), 'Eva te dio una referencia en Hockia')
  assertEquals(rs.referenceAcceptedSubject('Eva'), 'Eva vouched for you on Hockia')
})

Deno.test('reference reminder email: Spanish has no English, fallbacks are Spanish', () => {
  const recipient = { id: 'u1', email: 'x@y.test', full_name: 'Carla Gómez', username: 'carla' }
  const friend = { id: 'f1', full_name: 'Dani Sosa', username: 'dani', avatar_url: null, role: 'player' }
  const html = rm.generateReminderEmailHtml(recipient, friend, 'es')
  const text = rm.generateReminderEmailText(recipient, friend, 'es')
  assertNoEnglish('reminder html', html)
  assertNoEnglish('reminder text', text)
  assertStringIncludes(html, 'Pedirle una referencia a Dani')
  assertStringIncludes(text, 'ask=f1')
  assertEquals(rm.reminderSubject('es'), 'Sumar confianza a tu perfil de Hockia')
  assertEquals(rm.reminderSubject(), 'Add trust to your Hockia profile')
  const noNames = { ...friend, full_name: null, username: null }
  assertEquals(rm.friendFirstName(noNames, 'es'), 'una conexión')
  assertEquals(rm.friendFirstName(noNames), 'a connection')
  assertEquals(rm.recipientFirstName({ full_name: null, username: null }), 'there')
})

Deno.test('message digest: Spanish builders and template variables; English variables unchanged', () => {
  const recipient = { id: 'u1', email: 'x@y.test', full_name: 'Carla Gómez', is_test_account: false, notify_messages: true }
  for (const convs of [conversations, conversations.slice(0, 1)]) {
    assertNoEnglish('digest html', md.generateEmailHtml(recipient, convs, 'es'))
    assertNoEnglish('digest text', md.generateEmailText(recipient, convs, 'es'))
  }
  assertStringIncludes(md.generateEmailText(recipient, conversations, 'es'), 'Eva: 3 mensajes nuevos')

  const es = md.messageDigestTemplateVars('Carla Gómez', conversations, 'https://h.test', 'es')
  assertEquals(es.heading, 'Hay 4 mensajes nuevos')
  assertEquals(es.cta_label, 'Ver mensajes')
  assertEquals(es.conversations_text, 'Dani Sosa: 1 mensaje nuevo\nEva: 3 mensajes nuevos')
  assertEquals(es.first_name, 'Carla')
  assertEquals(md.messageDigestTemplateVars(null, conversations, 'https://h.test', 'es').first_name, 'integrante')

  // English: exactly what notify-message-digest built inline before.
  const en = md.messageDigestTemplateVars('Carla Gómez', conversations, 'https://h.test')
  assertEquals(en, {
    first_name: 'Carla',
    heading: 'You have 4 new messages',
    message_count: '4',
    conversations: JSON.stringify(conversations),
    conversations_text: 'Dani Sosa: 1 new message\nEva: 3 new messages',
    cta_url: 'https://h.test/messages',
    cta_label: 'View messages',
    settings_url: 'https://h.test/settings',
  })
  assertEquals(md.messageDigestTemplateVars(null, conversations.slice(0, 1), 'https://h.test').heading, 'New message from Dani Sosa')
  assertEquals(md.messageDigestTemplateVars(null, conversations.slice(0, 1), 'https://h.test').first_name, 'there')
})

Deno.test('profile views: Spanish lines, phrases and builders; English unchanged', () => {
  assertEquals(pv.composeStatsLine({ club: 2, coach: 1, player: 4, zebra: 1 }, 'es'),
    '2 clubes · 1 entrenador/a · 4 jugadores/as · 1 perfil de otro tipo')
  assertEquals(pv.composeStatsLine({ club: 2, coach: 1, player: 4, zebra: 1 }), '2 clubs · 1 coach · 4 players · 1 other')
  assertEquals(pv.composeTrendLine(5, 2, 'es'), '5 visitas al perfil esta semana, más que las 2 de la semana anterior.')
  assertEquals(pv.composeTrendLine(1, 0, 'es'), '1 visita al perfil esta semana.')
  assertEquals(pv.composeTrendLine(5, 2), '5 profile views this week, up from 2 the week before.')
  assertEquals(pv.composeTrendLine(3, null, 'es'), '')
  assertEquals(pv.viewCountPhrase(1, 'es'), '1 persona')
  assertEquals(pv.viewCountPhrase(3), '3 people')
  assertEquals(pv.profileViewsCtaLabel(), 'See your week on Hockia')
  assertEquals(pv.profileViewsFallbackSubject(1), 'Someone viewed your Hockia profile')
  assertNoEnglish('profile views subject', pv.profileViewsFallbackSubject(3, 'es'))
  const recipient = { id: 'u1', email: 'x@y.test', full_name: 'Carla Gómez', is_test_account: false, notify_profile_views: true }
  const stats = {
    uniqueViewers: 3, totalViews: 5, anonymousViewers: 1,
    statsLine: pv.composeStatsLine({ club: 1, player: 2 }, 'es'), trendLine: pv.composeTrendLine(5, 2, 'es'),
  }
  assertNoEnglish('profile views html', pv.generateEmailHtml(recipient, [], stats, 'es'))
  assertNoEnglish('profile views text', pv.generateEmailText(recipient, [], stats, 'es'))
})

Deno.test('vacancy email: Spanish has no English, position in Spanish; English unchanged', () => {
  const html = vc.generateEmailHtml(vacancy, 'HC Rosario', 'es')
  const text = vc.generateEmailText(vacancy, 'HC Rosario', 'es')
  assertNoEnglish('vacancy html', html)
  assertNoEnglish('vacancy text', text)
  assertStringIncludes(text, 'Posición: Volante')
  assertStringIncludes(text, 'Volante 2027')
  assertEquals(vc.vacancyPositionLabel('head_coach', 'es'), 'Entrenador/a principal')
  assertEquals(vc.vacancyPositionLabel('head_coach'), 'Head coach')
  assertEquals(vc.spanishPositionOr('goalkeeper', 'Goalkeeper'), 'Arquero/a')
  assertEquals(vc.spanishPositionOr('sweeper', 'Sweeper'), 'Sweeper')
  assertEquals(vc.vacancyFallbackSubject('X'), 'New opportunity on Hockia: X')
  assertEquals(vc.unnamedClub('es'), 'Un club')
  assertStringIncludes(vc.generateEmailText(vacancy, 'HC'), 'Position: Midfielder')
})

Deno.test('opportunity suggestions: Spanish heading and labels; English unchanged', () => {
  const s = [{
    opportunity_id: 'o9', title: 'Delantera', position_text: 'forward', opportunity_type: 'player',
    gender: 'Women', location_city: 'Rosario', location_country: 'Argentina', publisher_name: 'HC',
  }]
  const text = sg.suggestionsText(s, 'https://h.test', 'es')
  assertStringIncludes(text, 'Oportunidades abiertas que pueden interesarte:')
  assertStringIncludes(text, 'Delantero/a · Damas · Rosario, Argentina · HC')
  assertNoEnglish('suggestions html', sg.suggestionsHtml(s, 'https://h.test', 'es'))
  assertEquals(sg.suggestionsText(s, 'https://h.test'),
    '\nOpen opportunities for you:\n- Delantera (forward · Women · Rosario, Argentina · HC): https://h.test/opportunities/o9')
})

// ── 3. Renderer ────────────────────────────────────────────────────────────

const blocks: ContentBlock[] = [
  { type: 'heading', text: '{{heading}}', level: 1 },
  { type: 'conversation_list', conversations_var: 'conversations' },
  { type: 'button', text: '', url: '{{cta_url}}' },
]

/** Fake client over email_templates rows. */
function templateClient(rows: Array<{ template_key: string; subject_template: string; is_active?: boolean }>) {
  return {
    from: (_t: string) => ({
      select: (_c: string) => ({
        eq: (_col: string, key: string) => ({
          eq: (_c2: string, _v: boolean) => ({
            single: () => {
              const row = rows.find(r => r.template_key === key && r.is_active !== false)
              return Promise.resolve(row
                ? {
                  data: {
                    id: key, template_key: key, name: key, subject_template: row.subject_template,
                    content_json: blocks, text_template: '{{heading}}\n{{settings_url}}', variables: [], is_active: true,
                  },
                  error: null,
                }
                : { data: null, error: { message: 'not found' } })
            },
          }),
        }),
      }),
    }),
  }
}

type Client = Parameters<typeof renderTemplate>[0]

const varsFor = (lang: MemberLanguage) => ({
  heading: lang === 'es' ? 'Mensajes nuevos' : 'New messages',
  conversations: JSON.stringify(conversations),
  cta_url: 'https://h.test/messages',
})

Deno.test('renderTemplate: Spanish row when present, Spanish layout text', async () => {
  const client = templateClient([
    { template_key: 'message_digest', subject_template: 'EN subject' },
    { template_key: 'message_digest__es', subject_template: 'ES asunto' },
  ]) as unknown as Client
  const es = await renderTemplate(client, 'message_digest', varsFor, 'es')
  assert(es)
  assertEquals(es.language, 'es')
  assertEquals(es.subject, 'ES asunto')
  assertStringIncludes(es.html, '<html lang="es">')
  assertStringIncludes(es.html, 'Mensajes nuevos')
  assertStringIncludes(es.html, '3 mensajes nuevos')
  assertStringIncludes(es.html, 'Este email te llega por tu cuenta en Hockia.')
  assertStringIncludes(es.html, 'Ajustes de notificaciones')
  assertStringIncludes(es.html, 'Ver más')
  assertNoEnglish('rendered es', es.html)

  const en = await renderTemplate(client, 'message_digest', varsFor)
  assert(en)
  assertEquals(en.language, 'en')
  assertEquals(en.subject, 'EN subject')
  assertStringIncludes(en.html, '<html lang="en">')
  assertStringIncludes(en.html, "You're receiving this because you have a Hockia account.")
  assertStringIncludes(en.html, '3 new messages')
})

Deno.test('renderTemplate: Spanish falls back to the English row with English variables', async () => {
  const client = templateClient([
    { template_key: 'message_digest', subject_template: 'EN subject' },
    { template_key: 'message_digest__es', subject_template: 'ES asunto', is_active: false },
  ]) as unknown as Client
  const r = await renderTemplate(client, 'message_digest', varsFor, 'es')
  assert(r)
  assertEquals(r.language, 'en')
  assertEquals(r.subject, 'EN subject')
  assertStringIncludes(r.html, 'New messages')
  assertStringIncludes(r.html, '<html lang="en">')
  assert(!r.html.includes('Mensajes nuevos'))
  assertEquals(await renderTemplate(templateClient([]) as unknown as Client, 'message_digest', varsFor, 'es'), null)
})

Deno.test('renderContentBlocks: English output unchanged by the language option', () => {
  const vars = varsFor('en')
  assertEquals(renderContentBlocks(blocks, vars), renderContentBlocks(blocks, vars, { language: 'en' }))
  assertEquals(renderContentBlocks(blocks, vars, { isOutreach: true }).html,
    renderContentBlocks(blocks, vars, { isOutreach: true, language: 'es' }).html)
})

// ── 4. Migration rows ──────────────────────────────────────────────────────

const MIGRATIONS = new URL('../../migrations/', import.meta.url)

/** (key, subject, text, content) tuples from a VALUES list written with $t$ quotes. */
function parseRows(sql: string, fields: number): Map<string, string[]> {
  const quoted = [...sql.matchAll(/\$t\$([\s\S]*?)\$t\$/g)].map(m => m[1])
  const out = new Map<string, string[]>()
  for (let i = 0; i + fields <= quoted.length; i += fields) {
    if (!/^[a-z_]+$/.test(quoted[i])) break
    out.set(quoted[i], quoted.slice(i + 1, i + fields))
  }
  return out
}

const varNames = (s: string) => [...new Set([...s.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))].sort()

Deno.test('Spanish template rows keep the English structure and variables', async () => {
  const esSql = await Deno.readTextFile(new URL('20261116120000_email_templates_spanish.sql', MIGRATIONS))
  const enSql = await Deno.readTextFile(new URL('20261030120000_email_templates_rebrand.sql', MIGRATIONS))
  const esRows = parseRows(esSql, 4) // key, subject, text, content
  const enRows = parseRows(enSql, 7) // key, old x3, new subject, new text, new content
  const keys = [
    'application_notification', 'friend_request', 'message_digest', 'onboarding_reminder',
    'profile_view_digest', 'reference_request', 'vacancy_notification',
  ]
  assertEquals([...esRows.keys()].sort(), keys)
  for (const key of keys) {
    const [esSubject, esText, esContent] = esRows.get(key)!
    const en = enRows.get(key)!
    const [enSubject, enText, enContent] = [en[3], en[4], en[5]]
    const esBlocks = JSON.parse(esContent) as ContentBlock[]
    const enBlocks = JSON.parse(enContent) as ContentBlock[]
    assertEquals(esBlocks.map(b => b.type), enBlocks.map(b => b.type), `${key}: block types`)
    assertEquals(varNames(esContent), varNames(enContent), `${key}: content variables`)
    assertEquals(varNames(esSubject), varNames(enSubject), `${key}: subject variables`)
    assertEquals(varNames(esText), varNames(enText), `${key}: text variables`)
    for (const [i, b] of esBlocks.entries()) {
      const e = enBlocks[i]
      for (const f of ['name_var', 'avatar_var', 'conversations_var', 'conditional', 'is_html', 'level'] as const) {
        assertEquals(b[f], e[f], `${key}: block ${i} ${f}`)
      }
      assertEquals(b.detail_vars, e.detail_vars, `${key}: block ${i} detail_vars`)
    }
    const literal = (s: string) => s.replace(/\{\{\w+\}\}/g, ' ')
    assertNoEnglish(`${key} subject`, literal(esSubject))
    assertNoEnglish(`${key} text`, literal(esText))
    for (const b of esBlocks) {
      for (const f of [b.text, b.label, b.title]) if (f) assertNoEnglish(`${key} block`, literal(f))
      for (const fld of b.fields ?? []) assertNoEnglish(`${key} field`, fld.label)
    }
  }
})
