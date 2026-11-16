import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import esInbox from '@/locales/es/inbox.json'
import esNotifications from '@/locales/es/notifications.json'
import esOpportunities from '@/locales/es/opportunities.json'
import esEnums from '@/locales/es/enums.json'
import { getNotificationConfig } from '@/components/notifications/config'
import type { NotificationRecord } from '@/lib/api/notifications'
import { clubInboxRoleLine, inboxWaitingNotice } from '@/lib/clubInbox'
import { recruitingServerLine, recruitingTitle } from '@/lib/recruitingTitles'
import { recruitingPreview } from '@/lib/signing'

// Staging review 2026-11-16: English left in the Spanish club inbox, activity and chat previews.

beforeAll(() => {
  // No network in the suite: the bundles below are added directly; a catalog fetch finds nothing new.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
  i18n.addResourceBundle('es', 'inbox', esInbox, true, true)
  i18n.addResourceBundle('es', 'notifications', esNotifications, true, true)
  i18n.addResourceBundle('es', 'opportunities', esOpportunities, true, true)
  i18n.addResourceBundle('es', 'enums', esEnums, true, true)
})

afterEach(async () => { await i18n.changeLanguage('en') })
afterAll(() => { vi.unstubAllGlobals() })

const rows = (n: number, applied: number) =>
  Array.from({ length: n }, (_, i) => ({ waiting: true, applied: i < applied }))

describe('club inbox copy', () => {
  it('stays as before in English', () => {
    expect(inboxWaitingNotice(rows(1, 1))).toEqual({ title: '1 person waiting for a first reply', sub: 'They applied to your opportunities.' })
    expect(inboxWaitingNotice(rows(3, 2))?.sub).toBe('2 of them applied to your opportunities.')
  })

  it('reads in Spanish', async () => {
    await i18n.changeLanguage('es')
    expect(inboxWaitingNotice(rows(2, 2))).toEqual({ title: '2 personas esperan una primera respuesta', sub: 'Todas se postularon a tus oportunidades.' })
    expect(clubInboxRoleLine('player', null, true)).toMatch(/ · Se postuló$/)
  })
})

describe('recruiting titles and chat lines', () => {
  it('shows the stored English line in English', () => {
    expect(recruitingTitle('offer_expired', 'Your offer to Ana expired')).toBe('Your offer to Ana expired')
    expect(recruitingServerLine('E2E Test FC undid the signing for Midfielder.')).toBe('E2E Test FC undid the signing for Midfielder.')
  })

  it('rebuilds them in Spanish, keeping names and roles', async () => {
    await i18n.changeLanguage('es')
    expect(recruitingTitle('offer_expired', 'Your offer to Ana expired')).toBe('Venció tu oferta a Ana')
    expect(recruitingTitle('signing_confirmed', 'The player confirmed the signing')).toBe('La persona confirmó la incorporación')
    expect(recruitingTitle('offer_expired', 'Something new')).toBe('Something new')
    expect(recruitingServerLine('E2E Test FC undid the signing for Midfielder.')).toBe('E2E Test FC deshizo la incorporación para Midfielder.')
    expect(recruitingPreview('Ana confirmed the signing for Midfielder. Signed through Hockia.', { isMine: false }))
      .toEqual({ text: 'Ana confirmó la incorporación para Midfielder. Incorporación a través de Hockia.', system: true })
    expect(recruitingPreview('Hola, ¿cómo va?', { isMine: false })).toEqual({ text: 'Hola, ¿cómo va?', system: false })
  })
})

describe('application status notification', () => {
  const rejected = {
    id: 'n1', kind: 'vacancy_application_status', sourceEntityId: 's1', targetUrl: null,
    createdAt: '2026-11-16T00:00:00Z', readAt: null, seenAt: null, clearedAt: null, actor: null,
    metadata: { status: 'rejected', club_name: 'E2E Test FC', vacancy_title: 'Men’s midfielder', position: 'midfielder' },
  } as unknown as NotificationRecord
  it('names the position in the active language', async () => {
    expect(getNotificationConfig(rejected).getDescription?.(rejected)).toBe('Not this time for Midfielder.')
    await i18n.changeLanguage('es')
    expect(getNotificationConfig(rejected).getDescription?.(rejected)).toBe('Esta vez no para Volante.')
  })
})
