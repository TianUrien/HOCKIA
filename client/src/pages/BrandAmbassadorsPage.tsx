import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Instagram } from 'lucide-react'
import Header from '@/components/Header'
import Avatar from '@/components/Avatar'
import RolePlaceholder from '@/components/RolePlaceholder'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { chipTone } from '@/components/ui/chipClasses'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useMyBrand } from '@/hooks/useMyBrand'
import { useBrandAmbassadors } from '@/hooks/useBrandAmbassadors'
import { useCountryNames } from '@/hooks/useCountryNames'
import { inviteAsAmbassador } from '@/lib/ambassadorInvite'
import { fetchCandidates, followersLabel, type AmbassadorCandidate } from '@/lib/brandPartnerships'
import { humanizeToken, positionLabel } from '@/lib/identity'
import { cn } from '@/lib/utils'

/**
 * Brand · Ambassadors (Figma 08 · Brands AC4–AC6, built 2026-11-07): your
 * ambassadors, and candidates: players who said yes to brand partnerships,
 * where the brand sells, with the Instagram they declared. Invite sends the
 * existing two-sided request; the player accepts or declines.
 */
export default function BrandAmbassadorsPage() {
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role)
  const { brand } = useMyBrand()
  const mine = useBrandAmbassadors(brand?.id)
  const names = useCountryNames()
  const addToast = useToastStore((s) => s.addToast)
  const qc = useQueryClient()
  const [tab, setTab] = useState<'mine' | 'candidates'>('candidates')
  const [country, setCountry] = useState<number | null>(null)
  const [position, setPosition] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['ambassador-candidates'], queryFn: () => fetchCandidates(null), enabled: role === 'brand', staleTime: 60_000 })

  const all = useMemo(() => q.data ?? [], [q.data])
  const countries = useMemo(() => [...new Set(all.map((c) => c.base_country_id).filter((x): x is number => x != null))], [all])
  const positions = useMemo(() => [...new Set(all.map((c) => c.player_position).filter((x): x is string => !!x))], [all])
  const shown = all.filter((c) => (country == null || c.base_country_id === country) && (position == null || c.player_position === position))
  const accepted = mine.ambassadors.filter((a) => a.status === 'accepted')

  if (role && role !== 'brand') return <Navigate to="/dashboard/profile" replace />

  const invite = async (c: AmbassadorCandidate) => {
    setSending(c.profile_id)
    const res = await inviteAsAmbassador(c.profile_id)
    setSending(null)
    if (res.ok || res.already) {
      qc.setQueryData<AmbassadorCandidate[]>(['ambassador-candidates'], (prev) => (prev ?? []).map((x) => (x.profile_id === c.profile_id ? { ...x, invited: true } : x)))
      addToast(`Invite sent to ${c.full_name ?? 'the player'}. They accept or decline from their inbox.`, 'success')
    } else {
      addToast(res.message ?? 'Couldn’t send the invite. Try again.', 'error')
    }
  }

  const countryLine = countries.length ? countries.map((id) => names([id])[0]).filter(Boolean).slice(0, 3).join(', ') : 'where you sell'

  return (
    <div className="min-h-screen bg-surface-subtle" data-testid="brand-ambassadors">
      <Header mobileHidden />
      <DetailNavBar parent="Profile" title="Ambassadors" fallbackPath="/dashboard/profile" />
      <main className="mx-auto max-w-[960px] px-4 pb-28 pt-3 lg:pt-under-header-lg">
        <SegmentedControl<'mine' | 'candidates'>
          ariaLabel="Ambassadors"
          value={tab}
          onChange={setTab}
          options={[{ value: 'mine', label: 'Your ambassadors', count: accepted.length }, { value: 'candidates', label: 'Candidates', count: all.length }]}
        />

        {tab === 'candidates' ? (
          <>
            <p className="mt-3 text-row text-ink-2">Players in {countryLine} who said yes to brand partnerships. Followers are what each player declared.</p>
            {countries.length > 1 || positions.length > 1 ? (
              <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="group" aria-label="Filters">
                <button type="button" aria-pressed={country == null && position == null} onClick={() => { setCountry(null); setPosition(null) }} className={cn('h-9 shrink-0 rounded-full px-4 text-row font-semibold', chipTone(country == null && position == null))}>All</button>
                {countries.length > 1 && countries.map((id) => (
                  <button key={id} type="button" aria-pressed={country === id} onClick={() => setCountry(country === id ? null : id)} className={cn('h-9 shrink-0 rounded-full px-4 text-row font-semibold', chipTone(country === id))}>{names([id])[0] ?? 'Country'}</button>
                ))}
                {positions.length > 1 && positions.map((p) => (
                  <button key={p} type="button" aria-pressed={position === p} onClick={() => setPosition(position === p ? null : p)} className={cn('h-9 shrink-0 rounded-full px-4 text-row font-semibold', chipTone(position === p))}>{positionLabel(p) ?? p}</button>
                ))}
              </div>
            ) : null}

            {q.isLoading ? <div className="mt-4 h-48 animate-pulse rounded-[20px] bg-white" /> : null}
            {!q.isLoading && shown.length === 0 ? (
              <div className="mt-4 rounded-[20px] bg-white p-5" data-testid="candidates-empty">
                <p className="text-body font-semibold text-ink-1">No candidates yet</p>
                <p className="mt-1 text-row text-ink-2">Players appear here when they turn on brand partnerships and live where you sell. Offers in more places bring more candidates.</p>
                <button type="button" onClick={() => navigate('/dashboard/offers')} className="mt-3 text-row font-semibold text-brand-primary">Open your offers ›</button>
              </div>
            ) : null}
            <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="candidates-grid">
              {shown.map((c) => (
                <li key={c.profile_id} className="overflow-hidden rounded-[20px] bg-white shadow-[0_1px_2px_rgba(15,15,20,0.06)]">
                  <button type="button" onClick={() => navigate(`/players/id/${c.profile_id}`)} className="block w-full text-left">
                    <span className="relative block aspect-square w-full overflow-hidden bg-surface-muted">
                      {c.avatar_url ? <img src={c.avatar_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <RolePlaceholder role="player" label="" />}
                    </span>
                    <span className="block p-3 pb-2">
                      <span className="block truncate text-row font-semibold text-ink-1">{c.full_name ?? 'Player'}</span>
                      <span className="block truncate text-secondary text-ink-2">{[positionLabel(c.player_position), humanizeToken(c.playing_category)].filter(Boolean).join(' · ') || 'Player'}</span>
                      <span className="block truncate text-secondary text-ink-2">{[c.base_city, c.base_country_id != null ? names([c.base_country_id])[0] : null].filter(Boolean).join(', ')}</span>
                      {c.instagram_handle ? (
                        <span className="mt-1 flex items-center gap-1 truncate text-secondary text-ink-1"><Instagram className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />@{c.instagram_handle}</span>
                      ) : null}
                      {followersLabel(c.instagram_followers) ? <span className="block truncate text-caption text-ink-3">{followersLabel(c.instagram_followers)}</span> : null}
                    </span>
                  </button>
                  <div className="px-3 pb-3">
                    <button
                      type="button"
                      disabled={c.invited || sending === c.profile_id}
                      onClick={() => void invite(c)}
                      className={cn('h-10 w-full rounded-full text-row font-semibold', c.invited ? 'bg-surface-muted text-ink-2' : 'bg-brand-soft text-brand-primary')}
                      data-testid="candidate-invite"
                    >
                      {c.invited ? 'Invited' : sending === c.profile_id ? 'Sending…' : 'Invite'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="mt-4">
            {accepted.length === 0 ? (
              <div className="rounded-[20px] bg-white p-5">
                <p className="text-body font-semibold text-ink-1">No ambassadors yet</p>
                <p className="mt-1 text-row text-ink-2">Invite a candidate. They show on your profile once they accept.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line rounded-[20px] bg-white">
                {accepted.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 p-3">
                    <Avatar src={a.avatar_url} alt={a.full_name ?? ''} role="player" size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-row font-semibold text-ink-1">{a.full_name ?? 'Player'}</p>
                      <p className="truncate text-secondary text-ink-2">{[positionLabel(a.position), a.current_club].filter(Boolean).join(' · ')}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
