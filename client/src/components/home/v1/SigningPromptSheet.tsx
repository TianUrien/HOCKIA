import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useUserPosts } from '@/hooks/useUserPosts'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { seasonLabel } from '@/lib/signing'
import { roleTitle, signingDetail } from '@/lib/homeEngagement'
import { NewSigningArt } from './NewSigningArt'

const WINDOW_DAYS = 21
const DISMISS_KEY = 'hockia.signingPrompt.dismissed'

interface Candidate {
  applicationId: string
  person: { id: string; full_name: string; avatar_url: string | null; role: string; position: string | null }
  role: string
  season: string
}

function dismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]') as string[]) } catch { return new Set() }
}
function dismiss(id: string) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed().add(id)].slice(-50))) } catch { /* private mode */ }
}

/**
 * "Post this signing?" (Figma H14 88:1092). The player confirms a signing
 * (confirm_signing); the club then gets this sheet on Home, pre-filled with
 * the New signing card — Post New Signing (primary 52) / Not now. Shown once
 * per signing (one sheet per visit): within 21 days of signed_at, not yet
 * posted, not dismissed.
 * The tagged member is notified by the server (and must be 18+).
 */
export function SigningPromptSheet() {
  const profile = useAuthStore((s) => s.profile)
  const addToast = useToastStore((s) => s.addToast)
  const queryClient = useQueryClient()
  const { createSigningPost } = useUserPosts()
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const [posting, setPosting] = useState(false)
  const isClub = profile?.role === 'club'

  const { data } = useQuery({
    queryKey: ['signing-prompt', profile?.id],
    enabled: isClub && Boolean(profile?.id),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Candidate[]> => {
      const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()
      const { data: apps, error } = await supabase
        .from('opportunity_applications')
        .select('id, applicant_id, signed_at, opportunity:opportunities!inner(title, position, gender, start_date, club_id)')
        .eq('status', 'signed')
        .eq('opportunity.club_id', profile!.id)
        .gte('signed_at', since)
        .order('signed_at', { ascending: false })
        .limit(10)
      if (error) throw error
      const rows = (apps ?? []) as unknown as Array<{ id: string; applicant_id: string; opportunity: { title: string; position: string | null; gender: string | null; start_date: string | null } }>
      const skip = dismissed()
      const open = rows.filter((r) => !skip.has(r.id))
      if (open.length === 0) return []
      const ids = [...new Set(open.map((r) => r.applicant_id))]
      const [{ data: people }, { data: posts }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, avatar_url, role, position').in('id', ids),
        supabase.from('user_posts').select('metadata').eq('author_id', profile!.id).eq('post_type', 'signing').is('deleted_at', null),
      ])
      const posted = new Set(((posts ?? []) as Array<{ metadata: { person_profile_id?: string } | null }>).map((p) => p.metadata?.person_profile_id).filter(Boolean))
      const byId = new Map(((people ?? []) as Candidate['person'][]).map((p) => [p.id, p]))
      return open
        .filter((r) => !posted.has(r.applicant_id) && byId.has(r.applicant_id))
        .map((r) => ({
          applicationId: r.id,
          person: byId.get(r.applicant_id)!,
          role: roleTitle(r.opportunity.position, r.opportunity.gender, r.opportunity.title),
          season: seasonLabel(r.opportunity.start_date),
        }))
    },
  })

  // One sheet per visit: the next pending signing waits for the next Home visit.
  const current = closed.size > 0 ? undefined : (data ?? [])[0]
  if (!isClub || !current || !profile) return null
  const first = current.person.full_name.trim().split(/\s+/)[0] || current.person.full_name

  const notNow = () => {
    dismiss(current.applicationId)
    setClosed((p) => new Set(p).add(current.applicationId))
  }
  const post = async () => {
    setPosting(true)
    const res = await createSigningPost(current.person.id, null, null, { role: current.role, season: current.season })
    setPosting(false)
    if (!res.success) { addToast(res.error ?? 'Could not post the signing', 'error'); return }
    dismiss(current.applicationId)
    setClosed((p) => new Set(p).add(current.applicationId))
    addToast('Signing posted', 'success')
    void queryClient.invalidateQueries({ queryKey: ['home-feed'] })
  }

  return (
    <BottomSheet open onClose={notNow} ariaLabel="Signing confirmed">
      <div className="px-4 pb-4 pt-1" data-testid="signing-prompt-sheet">
        <h2 className="text-[22px] font-bold leading-7 text-ink-1">Signing confirmed</h2>
        <p className="mt-1.5 text-[15px] leading-5 text-ink-2">Share it with the community? {first} is tagged and gets notified.</p>
        <NewSigningArt
          className="mt-4"
          personName={current.person.full_name}
          personAvatarUrl={current.person.avatar_url}
          clubName={profile.full_name ?? 'Your club'}
          clubCrestUrl={profile.avatar_url}
          detail={signingDetail({ signing_role: current.role, person_position: current.person.position, season: current.season })}
        />
        <button
          type="button"
          onClick={() => void post()}
          disabled={posting}
          className="mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-hockia-primary text-[17px] font-semibold text-white disabled:opacity-60"
        >
          {posting && <Loader2 className="h-4 w-4 animate-spin" />} Post New Signing
        </button>
        <button type="button" onClick={notNow} className="mt-1 flex h-11 w-full items-center justify-center text-[16px] font-semibold text-hockia-primary">
          Not now
        </button>
      </div>
    </BottomSheet>
  )
}
