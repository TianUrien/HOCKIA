/**
 * Inbox naming and the desktop pane (founder 2026-11-24).
 * - In Spanish the tab is "Inbox", not "Mensajes": it holds Messages,
 *   Requests and Activity, and "Mensajes" repeated the first segment.
 * - On desktop the right pane speaks about the segment in view, so Activity
 *   and Requests do not say "Choose a conversation".
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import enCommon from '@/locales/en/common.json'
import esCommon from '@/locales/es/common.json'
import enInbox from '@/locales/en/inbox.json'
import esInbox from '@/locales/es/inbox.json'

type Tree = { [k: string]: string | Tree }

function inboxPaths(en: Tree, es: Tree, path: string[] = [], out: string[] = []): string[] {
  for (const [k, v] of Object.entries(en)) {
    const other = es[k]
    if (typeof v === 'object' && typeof other === 'object') inboxPaths(v, other, [...path, k], out)
    else if (v === 'Inbox' && other !== 'Inbox') out.push([...path, k].join('.'))
  }
  return out
}

describe('Inbox', () => {
  it('is called "Inbox" in Spanish wherever English says "Inbox"', () => {
    expect(inboxPaths(enCommon as Tree, esCommon as Tree)).toEqual([])
    expect(inboxPaths(enInbox as Tree, esInbox as Tree)).toEqual([])
    expect((esInbox as Tree).segments).toMatchObject({ messages: 'Mensajes' })
  })

  it('the desktop pane has its own words for Activity and Requests', () => {
    const page = readFileSync(join(__dirname, '..', 'pages', 'MessagesPage.tsx'), 'utf8')
    for (const key of ['paneActivityTitle', 'paneActivityBody', 'paneRequestsTitle', 'paneRequestsBody']) {
      expect(page).toContain(`messagesPage.${key}`)
      expect((enInbox as Tree).messagesPage).toHaveProperty(key)
      expect((esInbox as Tree).messagesPage).toHaveProperty(key)
    }
  })
})
