import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { trackModuleClick } from '@/lib/homeInstrumentation'

export type HomeTab = 'pulse' | 'feed'

/**
 * Two-tab Home switch (Home redesign V2): Pulse (default, "state of your week")
 * / Feed (community). The active tab is reflected in the URL (?tab=) so the
 * Monday-recap deep-link can land straight on Pulse and a back-nav restores it.
 */
export function useHomeTab(): [HomeTab, (t: HomeTab) => void] {
  const [params, setParams] = useSearchParams()
  const initial: HomeTab = params.get('tab') === 'feed' ? 'feed' : 'pulse'
  const [tab, setTabState] = useState<HomeTab>(initial)

  useEffect(() => {
    const urlTab = params.get('tab')
    if (urlTab === 'feed' && tab !== 'feed') setTabState('feed')
    else if (urlTab !== 'feed' && tab !== 'pulse') setTabState('pulse')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const setTab = (t: HomeTab) => {
    setTabState(t)
    const next = new URLSearchParams(params)
    if (t === 'feed') next.set('tab', 'feed')
    else next.delete('tab')
    setParams(next, { replace: true })
    trackModuleClick(t === 'pulse' ? 'tab_pulse' : 'tab_feed', 0)
  }

  return [tab, setTab]
}
