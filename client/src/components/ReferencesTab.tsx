import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Profile } from '@/lib/supabase'
import { useReferenceFriendOptions } from '@/hooks/useReferenceFriendOptions'
import TrustedReferencesSection from './TrustedReferencesSection'

interface ReferencesTabProps {
  profileId: string
  readOnly?: boolean
  profileRole?: Profile['role'] | null
}

/**
 * ReferencesTab — own tab for the trusted-references surface, split out
 * of FriendsTab so the tab name matches the dominant content. Reads the
 * `?ask=<friend_id>` URL param (set by FriendsTab's "Ask to vouch"
 * button) so cross-tab navigation pre-fills the AddReferenceModal.
 */
export default function ReferencesTab({ profileId, readOnly = false, profileRole }: ReferencesTabProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const askParam = searchParams.get('ask')
  const [pendingAsk, setPendingAsk] = useState<string | null>(null)

  // Pull the ask param into local state once and clear it from the URL
  // so refreshing or copy-paste doesn't keep re-opening the modal.
  useEffect(() => {
    if (!askParam) return
    setPendingAsk(askParam)
    const next = new URLSearchParams(searchParams)
    next.delete('ask')
    setSearchParams(next, { replace: true })
  }, [askParam, searchParams, setSearchParams])

  const { friendOptions } = useReferenceFriendOptions(profileId)
  const safeFriendOptions = useMemo(() => friendOptions ?? [], [friendOptions])

  return (
    <div className="space-y-8">
      <TrustedReferencesSection
        profileId={profileId}
        friendOptions={safeFriendOptions}
        profileRole={profileRole}
        readOnly={readOnly}
        openAddReferenceForFriendId={pendingAsk}
        onAddReferenceConsumed={() => setPendingAsk(null)}
      />
    </div>
  )
}
