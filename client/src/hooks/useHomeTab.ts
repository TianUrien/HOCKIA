import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { trackModuleClick } from '@/lib/homeInstrumentation'

export type HomeTab = 'feed' | 'pulse'

/**
 * Two-tab Home switch: Feed (default, the community) / Pulse ("state of your
 * week"). The active tab is reflected in the URL (?tab=) so deep-links can
 * land on a specific tab and a back-nav restores it.
 *
 * FEED IS THE DEFAULT as of 2026-07-27 (founder call: the feed is where you
 * immediately see what's happening, so it's the primary landing experience).
 *
 * That inverts which value the URL has to carry: the DEFAULT tab is the one
 * with no param, so it is now `?tab=pulse` that is explicit and bare `/home`
 * that means Feed. `?tab=feed` is still honoured — links in the wild (and the
 * Pulse "Happening now" card) use it, and they must not break.
 *
 * Anything server-side that MEANS Pulse must therefore say so: the profile-views
 * and application-digest emails were pinned to /home?tab=pulse in the same
 * change, because they describe a card that only exists on Pulse.
 */
export function useHomeTab(): [HomeTab, (t: HomeTab) => void] {
  const [params, setParams] = useSearchParams()
  const initial: HomeTab = params.get('tab') === 'pulse' ? 'pulse' : 'feed'
  const [tab, setTabState] = useState<HomeTab>(initial)

  useEffect(() => {
    const urlTab = params.get('tab')
    if (urlTab === 'pulse' && tab !== 'pulse') setTabState('pulse')
    else if (urlTab !== 'pulse' && tab !== 'feed') setTabState('feed')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const setTab = (t: HomeTab) => {
    if (t === tab) return
    setTabState(t)
    const next = new URLSearchParams(params)
    if (t === 'pulse') next.set('tab', 'pulse')
    else next.delete('tab')
    // PUSH, not replace: a user tab switch is a navigation — browser Back
    // must return to the previous tab, not skip Home entirely (prod QA
    // caught replace:true eating the history entry).
    setParams(next)
    trackModuleClick(t === 'pulse' ? 'tab_pulse' : 'tab_feed', 0)
  }

  return [tab, setTab]
}
