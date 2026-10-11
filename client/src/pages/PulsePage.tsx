import { useCallback, useState } from 'react'
import { ActivityScreen } from '@/components/pulse/ActivityScreen'
import { PullToRefresh } from '@/components/PullToRefresh'
import { queryClient } from '@/lib/queryClient'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useScrollRestore } from '@/hooks/useScrollRestore'

/**
 * /pulse — "Your activity" (Figma H3 61:247). Founder ruling 11 Oct: it
 * replaces "Your week" for every role and screen size. The route stays
 * because old native apps and the profile-views / application emails link to
 * it; Home's Next step card shows the same actions one at a time.
 */
export default function PulsePage() {
  useScrollRestore()
  useDocumentTitle('Your activity')
  // Pulse hooks fetch on mount, not all through React Query — remounting is
  // how pull-to-refresh refreshes their numbers.
  const [refreshKey, setRefreshKey] = useState(0)
  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['pulse'] })
    setRefreshKey((k) => k + 1)
  }, [])

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <ActivityScreen key={refreshKey} />
    </PullToRefresh>
  )
}
