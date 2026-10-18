import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { YOUR_REPLIES_DAYS, yourReplies, type YourReplies } from '@/lib/yourReplies'

/** The publisher's own applications from the last 30 days → Your replies (CS8). null = not enough to show. */
export function useYourReplies(publisherId: string | null | undefined): YourReplies | null {
  const [value, setValue] = useState<YourReplies | null>(null)
  useEffect(() => {
    if (!publisherId) return
    let cancelled = false
    const since = new Date(Date.now() - YOUR_REPLIES_DAYS * 86_400_000).toISOString()
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('opportunity_applications')
          // The applicant join drops rows the club can't see (hidden profiles), like the applicants list.
          .select('status, applicant:applicant_id ( id ), opportunity:opportunity_id!inner ( club_id )')
          .eq('opportunity.club_id', publisherId)
          .gte('applied_at', since)
        if (cancelled || error || !data) return
        const rows = data as unknown as { status: string; applicant: { id: string } | null }[]
        setValue(yourReplies(rows.filter((r) => r.applicant).map((r) => r.status)))
      } catch {
        /* best effort: the card just doesn't show */
      }
    })()
    return () => { cancelled = true }
  }, [publisherId])
  return value
}
