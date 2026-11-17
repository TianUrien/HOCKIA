import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import esCommon from '@/locales/es/common.json'

/**
 * A member who reads Hockia in Spanish because of their device, and never
 * used the switch, must have that language saved on the profile and the
 * account: the server writes emails and pushes from there.
 */
const { store, updateUser, update, eq } = vi.hoisted(() => {
  type State = { user: unknown; profile: unknown }
  let state: State = { user: null, profile: null }
  const listeners = new Set<() => void>()
  const store = {
    getState: () => state,
    setState: (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach((l) => l()) },
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l) },
  }
  const eq = vi.fn(async () => ({ error: null }))
  const update = vi.fn(() => ({ eq }))
  const updateUser = vi.fn(async () => ({ error: null }))
  return { store, updateUser, update, eq }
})

vi.mock('@/lib/auth', async () => {
  const { useSyncExternalStore } = await import('react')
  const useAuthStore = Object.assign(
    <T,>(selector: (s: ReturnType<typeof store.getState>) => T) => useSyncExternalStore(store.subscribe, () => selector(store.getState())),
    { getState: store.getState, setState: store.setState },
  )
  return { useAuthStore }
})
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { updateUser }, from: () => ({ update }) } }))

import { setLanguage } from '@/i18n'
import { LANGUAGE_STORAGE_KEY } from '@/i18n/languages'
import { LanguageBoundary } from '@/i18n/LanguageBoundary'

const member = (ui_language: string | null) => ({ user: { id: 'u1', user_metadata: {} }, profile: { id: 'u1', ui_language } })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(esCommon), { status: 200 })))
  window.localStorage.removeItem(LANGUAGE_STORAGE_KEY)
  store.setState({ user: null, profile: null })
  updateUser.mockClear(); update.mockClear(); eq.mockClear()
})

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  await setLanguage('en')
})

describe('device language is saved for the server', () => {
  it('saves Spanish on the profile and the account when the device chose it', async () => {
    await setLanguage('es') // what start-up does on a Spanish device: nothing stored
    store.setState(member(null))
    render(<LanguageBoundary><p>app</p></LanguageBoundary>)
    await waitFor(() => expect(update).toHaveBeenCalledWith({ ui_language: 'es' }))
    expect(eq).toHaveBeenCalledWith('id', 'u1')
    expect(updateUser).toHaveBeenCalledWith({ data: { ui_language: 'es' } })
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull()
  })

  it('writes nothing for an English device', async () => {
    store.setState(member(null))
    render(<LanguageBoundary><p>app</p></LanguageBoundary>)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(update).not.toHaveBeenCalled()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('never overwrites a language the member chose', async () => {
    await setLanguage('es')
    store.setState(member('en'))
    render(<LanguageBoundary><p>app</p></LanguageBoundary>)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(update).not.toHaveBeenCalled()
  })

  it('writes nothing while signed out', async () => {
    await setLanguage('es')
    render(<LanguageBoundary><p>app</p></LanguageBoundary>)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(update).not.toHaveBeenCalled()
  })
})
