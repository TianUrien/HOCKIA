import { useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * Role gating for actions on a person (design audit 2026-10-21, A7):
 * brands have followers, not friends. A brand viewing a person gets Message
 * as the Primary and, for players only, "Invite as ambassador" as Tonal. No
 * "Add friend" for brands anywhere (deck, preview, public profile, desktop).
 */
export interface PersonActionGate {
  /** Whether the viewer may be offered "Add friend". */
  addFriend: boolean
  /** Whether "Invite as ambassador" (Tonal) is offered. */
  inviteAmbassador: boolean
  /** Message is the screen's Primary. */
  messagePrimary: boolean
}

export function personActionGate(viewerRole: string | null | undefined, targetRole: string | null | undefined): PersonActionGate {
  if (viewerRole === 'brand') {
    return { addFriend: false, inviteAmbassador: targetRole === 'player', messagePrimary: true }
  }
  return { addFriend: true, inviteAmbassador: false, messagePrimary: false }
}

export const INVITE_AMBASSADOR_LABEL = 'Invite as ambassador'

export type AmbassadorInviteResult = { ok: true } | { ok: false; message: string; already?: boolean }

/** Friendly words for the add_brand_ambassador RPC's error strings. */
export function ambassadorInviteError(raw: string | null | undefined): { message: string; already: boolean } {
  switch (raw) {
    case 'Request already pending':
      return { message: 'Invite already sent.', already: true }
    case 'Player is already an ambassador':
      return { message: 'Already one of your ambassadors.', already: true }
    case 'Only players can be ambassadors':
      return { message: 'Only players can be ambassadors.', already: false }
    default:
      return { message: 'Couldn’t send the invite. Try again.', already: false }
  }
}

/**
 * Sends the existing two-sided ambassador request (RPC add_brand_ambassador,
 * the same one the brand dashboard's "Invite athletes" uses). The player gets
 * the ambassador_request_received notification and accepts or declines.
 */
export async function inviteAsAmbassador(playerId: string): Promise<AmbassadorInviteResult> {
  try {
    const { data: brand, error: brandError } = await supabase.rpc('get_my_brand')
    const brandId = (brand as { id?: string } | null)?.id ?? null
    if (brandError || !brandId) {
      if (brandError) logger.error('[ambassadorInvite] get_my_brand failed', brandError)
      return { ok: false, message: 'Couldn’t send the invite. Try again.' }
    }
    const { data, error } = await supabase.rpc('add_brand_ambassador', { p_brand_id: brandId, p_player_id: playerId })
    if (error) throw error
    const result = data as { success: boolean; error?: string } | null
    if (result?.success) return { ok: true }
    const mapped = ambassadorInviteError(result?.error)
    return { ok: false, message: mapped.message, already: mapped.already }
  } catch (err) {
    logger.error('[ambassadorInvite] add_brand_ambassador failed', err)
    return { ok: false, message: 'Couldn’t send the invite. Try again.' }
  }
}

/** State for an "Invite as ambassador" button: idle → sending → sent. */
export function useAmbassadorInvite(playerId: string | null | undefined, onMessage?: (text: string, tone: 'success' | 'error' | 'info') => void) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const invite = useCallback(async () => {
    if (!playerId || state !== 'idle') return
    setState('sending')
    const res = await inviteAsAmbassador(playerId)
    if (res.ok) {
      setState('sent')
      onMessage?.('Ambassador invite sent.', 'success')
    } else if (res.already) {
      setState('sent')
      onMessage?.(res.message, 'info')
    } else {
      setState('idle')
      onMessage?.(res.message, 'error')
    }
  }, [playerId, state, onMessage])
  return { state, invite, label: state === 'sent' ? 'Invite sent' : INVITE_AMBASSADOR_LABEL }
}
