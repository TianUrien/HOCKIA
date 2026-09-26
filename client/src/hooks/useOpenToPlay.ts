import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { qk } from '@/lib/queryKeys'
import { isMissingBackendError } from '@/lib/missingBackend'
import {
  checkCanToggleOpenToPlay,
  isAdultByDob,
  setOpenToPlay,
  type SetOpenToPlayInput,
  type SetOpenToPlayResult,
} from '@/lib/openToPlay'

/**
 * The signed-in player's Open to play state (D2.4).
 *
 *  - `canToggle`: show the switch? Server-decided (18+ by date of birth);
 *    16–17-year-olds and unknown ages get false. Defaults to false while loading
 *    (`canToggleLoading`). Where can_toggle_open_to_play isn't deployed yet the
 *    same rule runs on the owner's own date of birth.
 *  - `needsDob`: no date of birth on file → the screen asks for it first.
 *  - `save(input)`: one write of open / from / for through set_open_to_play,
 *    which also stamps availability_confirmed_at. On success the local auth
 *    profile is updated so every surface reflects it without a refetch. Where
 *    the RPC isn't deployed yet it falls back to the plain profile write the
 *    old toggle made (turning ON still requires 18+ by date of birth).
 */
export function useOpenToPlay() {
  const profile = useAuthStore((s) => s.profile)
  const setProfile = useAuthStore((s) => s.setProfile)
  const profileId = profile?.id ?? null
  const isPlayer = profile?.role === 'player'
  const dob = profile?.date_of_birth ?? null

  const { data: canToggleServer, isLoading } = useQuery({
    queryKey: qk.canToggleOpenToPlay(profileId),
    enabled: !!profileId && isPlayer,
    staleTime: 10 * 60_000,
    queryFn: () => checkCanToggleOpenToPlay(profileId as string),
  })
  // null = RPC not deployed on this environment → same rule, client side.
  const canToggle = isPlayer && (canToggleServer === null ? isAdultByDob(dob) : canToggleServer === true)

  const save = useCallback(async (input: SetOpenToPlayInput): Promise<SetOpenToPlayResult> => {
    let result = await setOpenToPlay(input)
    if (!result.ok && result.outcome === 'error' && isMissingBackendError(result.error)) {
      result = await legacySave(input)
    }
    if (!result.ok) {
      if (result.outcome === 'error') logger.error('[useOpenToPlay] save failed', result.error)
      return result
    }
    const current = useAuthStore.getState().profile
    if (current) {
      setProfile({
        ...current,
        open_to_play: input.open,
        available_from: input.availableFrom ?? null,
        availability_duration: input.duration ?? null,
        availability_confirmed_at: result.confirmedAt ?? current.availability_confirmed_at ?? null,
      })
    }
    return result
  }, [setProfile])

  return {
    canToggle,
    canToggleLoading: isPlayer && isLoading,
    needsDob: isPlayer && !dob,
    openToPlay: profile?.open_to_play === true,
    availableFrom: profile?.available_from ?? null,
    availabilityDuration: profile?.availability_duration ?? null,
    confirmedAt: profile?.availability_confirmed_at ?? null,
    save,
  }
}

/** Pre-migration fallback: the profile write the old toggle made. */
async function legacySave(input: SetOpenToPlayInput): Promise<SetOpenToPlayResult> {
  const profile = useAuthStore.getState().profile
  if (!profile) return { ok: false, outcome: 'unauthenticated', confirmedAt: null }
  if (input.open && !profile.date_of_birth) return { ok: false, outcome: 'dob_required', confirmedAt: null }
  if (input.open && !isAdultByDob(profile.date_of_birth)) return { ok: false, outcome: 'under_18', confirmedAt: null }
  const { error } = await supabase
    .from('profiles')
    .update({
      open_to_play: input.open,
      available_from: input.availableFrom ?? null,
      availability_duration: input.duration ?? null,
    })
    .eq('id', profile.id)
  if (error) return { ok: false, outcome: 'error', confirmedAt: null, error }
  return { ok: true, outcome: 'saved', confirmedAt: null }
}
