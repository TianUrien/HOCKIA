import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { qk } from '@/lib/queryKeys'
import {
  canToggleOpenToPlay,
  setOpenToPlay,
  type SetOpenToPlayInput,
  type SetOpenToPlayResult,
} from '@/lib/openToPlay'

/**
 * The signed-in player's Open to play state (D2.4).
 *
 *  - `canToggle`: show the switch? Server-decided (18+ by date of birth);
 *    16–17-year-olds and unknown ages get false. Defaults to false while loading.
 *  - `save(input)`: one write of open / from / for through set_open_to_play,
 *    which also stamps availability_confirmed_at. On success the local auth
 *    profile is updated so every surface reflects it without a refetch.
 */
export function useOpenToPlay() {
  const profile = useAuthStore((s) => s.profile)
  const setProfile = useAuthStore((s) => s.setProfile)
  const profileId = profile?.id ?? null
  const isPlayer = profile?.role === 'player'

  const { data: canToggle } = useQuery({
    queryKey: qk.canToggleOpenToPlay(profileId),
    enabled: !!profileId && isPlayer,
    staleTime: 10 * 60_000,
    queryFn: () => canToggleOpenToPlay(profileId as string),
  })

  const save = useCallback(async (input: SetOpenToPlayInput): Promise<SetOpenToPlayResult> => {
    const result = await setOpenToPlay(input)
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
        availability_confirmed_at: result.confirmedAt ?? new Date().toISOString(),
      })
    }
    return result
  }, [setProfile])

  return {
    canToggle: isPlayer && canToggle === true,
    openToPlay: profile?.open_to_play === true,
    availableFrom: profile?.available_from ?? null,
    availabilityDuration: profile?.availability_duration ?? null,
    confirmedAt: profile?.availability_confirmed_at ?? null,
    save,
  }
}
