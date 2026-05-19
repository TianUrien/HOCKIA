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
  const [searchParams] = useSearchParams()
  const askParam = searchParams.get('ask')
  const [pendingAsk, setPendingAsk] = useState<string | null>(null)

  // Pull the ask param into local state. We deliberately do NOT strip it
  // from the URL so the link stays shareable / refreshable — paste it,
  // get the same modal. Trade-off: refresh re-opens the modal, which the
  // user can dismiss via the modal's close button. Re-fire if the param
  // changes (e.g. switching friends from the same tab session).
  useEffect(() => {
    if (!askParam) return
    setPendingAsk(askParam)
  }, [askParam])

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
