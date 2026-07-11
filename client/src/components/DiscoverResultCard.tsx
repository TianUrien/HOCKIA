import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Globe2, Check } from 'lucide-react'
import Avatar from '@/components/Avatar'
import RoleBadge from '@/components/RoleBadge'
import { ConditionalAvailabilityPill } from '@/components/AvailabilityPill'
import { isOpenToAvailability } from '@/lib/availabilityLabel'
import type { DiscoverResult } from '@/hooks/useDiscover'
import { getSpecializationLabel } from '@/lib/coachSpecializations'

interface DiscoverResultCardProps {
  result: DiscoverResult
}

// Phase 4 MVP-A — fit-level visual treatment. emerald = positive accent,
// sky = neutral-positive, gray = muted. "Strong match" means strong against
// the search criteria, not a quality judgement of the person.
const FIT_LEVEL_PRESET: Record<NonNullable<DiscoverResult['fit_level']>, {
  label: string
  pillBg: string
  pillText: string
}> = {
  strong_match: { label: 'Strong match', pillBg: 'bg-emerald-50', pillText: 'text-emerald-700' },
  possible_match: { label: 'Good match', pillBg: 'bg-sky-50', pillText: 'text-sky-700' },
  needs_more_info: { label: 'Needs more info', pillBg: 'bg-gray-100', pillText: 'text-gray-600' },
}

/** Title-case a stored lowercase position word for display. */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Claimed / directory pill for World-directory club rows. */
function WorldClubPill({ claimed }: { claimed: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${
        claimed ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
      }`}
      title={claimed
        ? 'Active on HOCKIA — you can message them inside the platform'
        : 'In the global directory — not yet active on HOCKIA'}
    >
      <Globe2 className="w-2.5 h-2.5" aria-hidden="true" />
      {claimed ? 'Claimed' : 'Directory'}
    </span>
  )
}

/** One label / value line in the expanded "Key info" block. */
function KeyInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="text-[11px] text-gray-400 flex-shrink-0">{label}</span>
      <span className="text-xs text-gray-800 text-right truncate">{value}</span>
    </div>
  )
}

/**
 * A single Hockia AI search result — a flat list row, Apple-list style.
 *
 * No card box or shadow: rows are separated by the parent's hairline
 * dividers, which keeps a long result list light and scannable. Tapping the
 * row body opens the full profile; the chevron on the right expands an
 * in-place drawer.
 *
 * The compact row carries the full summary exactly once (name, role,
 * position, dual nationality, club, match strength, availability). The
 * drawer never repeats any of it — it holds only *additional* facts (Age,
 * Based in; Phase 3 adds Journey highlights, references, etc.).
 *
 * World-directory club rows carry no profile-shaped detail, so they render
 * as a plain navigation row with no expander.
 */
export default function DiscoverResultCard({ result }: DiscoverResultCardProps) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)

  const isWorldClub = result.result_type === 'world_club'

  const handleNavigate = () => {
    if (isWorldClub) {
      if (result.claimed && result.claimed_profile_id) {
        navigate(`/clubs/id/${result.claimed_profile_id}?ref=discover`)
      } else if (result.country_code) {
        navigate(`/world/${result.country_code.toLowerCase()}?ref=discover`)
      } else {
        navigate('/world?ref=discover')
      }
      return
    }
    if (result.role === 'brand') navigate('/marketplace')
    else if (result.role === 'club') navigate(`/clubs/id/${result.id}?ref=discover`)
    else if (result.role === 'umpire') navigate(`/umpires/id/${result.id}?ref=discover`)
    else if (result.role === 'coach') navigate(`/coaches/id/${result.id}?ref=discover`)
    else navigate(`/players/id/${result.id}?ref=discover`)
  }

  const specializationLabel = !isWorldClub && result.role === 'coach' && result.coach_specialization
    ? getSpecializationLabel(result.coach_specialization, result.coach_specialization_custom)
    : null

  // Secondary line under the name: position(s) for a player, specialization
  // for a coach, league/region for a World-directory club.
  const positionLine = isWorldClub
    ? [result.league_name, result.province_name, result.base_country_name].filter(Boolean).join(' · ')
    : specializationLabel
      || [result.position, result.secondary_position].filter(Boolean).map(s => cap(s as string)).join(' · ')
      || null

  const nationality = !isWorldClub ? result.nationality_name : null
  const nationality2 = !isWorldClub ? result.nationality2_name : null
  const baseLine = result.base_location || result.base_country_name
  const club = !isWorldClub ? result.current_club : null

  const fitPreset = result.fit_level ? FIT_LEVEL_PRESET[result.fit_level] : null

  const availabilityPill = !isWorldClub && isOpenToAvailability(result.role, result) ? (
    <ConditionalAvailabilityPill
      role={result.role}
      open_to_play={result.open_to_play}
      open_to_coach={result.open_to_coach}
      open_to_opportunities={result.open_to_opportunities}
      size="sm"
    />
  ) : null

  // Compact-row meta line — dual nationality only. The current club moved
  // into the Key info drawer: next to two nationalities it never had room
  // and only ever rendered as a useless one-letter truncation.
  const isPersonRole = !isWorldClub && (result.role === 'player' || result.role === 'coach')
  const metaItems: { flag?: string | null; text: string }[] = []
  if (nationality) metaItems.push({ flag: result.flag_emoji, text: nationality })
  // Production audit B22 — some profiles have the same nationality stored
  // twice (e.g. Argentine + Argentine). Skip the duplicate display rather
  // than render the same flag and label back-to-back.
  if (nationality2 && nationality2.toLowerCase() !== (nationality ?? '').toLowerCase()) {
    metaItems.push({ flag: result.flag_emoji2, text: nationality2 })
  }

  // Expanded drawer "Key info" — facts NOT on the compact row. Nationality
  // and availability appear above and are never repeated; current club
  // lives here (it doesn't fit above). The drawer is for additional
  // insight. (Phase 3 adds Journey highlights, references, and strengths.)
  const keyInfo: { label: string; value: string }[] = []
  if (result.age != null) keyInfo.push({ label: 'Age', value: String(result.age) })
  if (baseLine) keyInfo.push({ label: 'Based in', value: baseLine })
  if (isPersonRole) keyInfo.push({ label: 'Current club', value: club || 'No current club' })
  else if (club) keyInfo.push({ label: 'Current club', value: club })

  // Phase 3 — rule-based Journey highlights, derived by the backend.
  const highlights = !isWorldClub ? (result.highlights ?? []) : []

  // World-club rows carry no profile-shaped detail — no expander for them.
  const canExpand = !isWorldClub && (keyInfo.length > 0 || highlights.length > 0)

  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-3">
        {/* Body — tapping it opens the full profile. */}
        <button
          type="button"
          onClick={handleNavigate}
          className="flex-1 min-w-0 flex items-start gap-3 text-left"
        >
          <Avatar
            src={result.avatar_url}
            alt={result.full_name ?? undefined}
            initials={result.full_name?.charAt(0)}
            size="md"
            role={isWorldClub ? 'club' : result.role}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-semibold text-gray-900 truncate">
                {result.full_name ?? 'Unknown'}
              </span>
              {isWorldClub ? (
                <WorldClubPill claimed={!!(result.claimed && result.claimed_profile_id)} />
              ) : (
                <RoleBadge role={result.role} className="flex-shrink-0" />
              )}
            </div>

            {positionLine && (
              <p className="text-xs text-gray-500 truncate mt-0.5">{positionLine}</p>
            )}

            {metaItems.length > 0 && (
              <div className="flex items-center gap-x-1.5 mt-1 text-xs text-gray-600">
                {metaItems.map((it, i) => (
                  <span key={i} className="inline-flex items-center gap-x-1.5">
                    {i > 0 && <span className="text-gray-300" aria-hidden="true">·</span>}
                    <span className="inline-flex items-center gap-1">
                      {it.flag && <span aria-hidden="true">{it.flag}</span>}
                      <span>{it.text}</span>
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Match strength + availability, stacked on the right. */}
          {(fitPreset || availabilityPill) && (
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              {fitPreset && (
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${fitPreset.pillBg} ${fitPreset.pillText}`}
                >
                  {fitPreset.label}
                </span>
              )}
              {availabilityPill}
            </div>
          )}
        </button>

        {/* Expander — chevron on the right, Apple-list style. */}
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            aria-label={expanded ? 'Hide details' : 'Show details'}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-400 hover:border-hockia-primary/40 hover:text-hockia-primary transition-colors"
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {/* Drawer — grid-rows 0fr→1fr animates to natural height. */}
      {canExpand && (
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-out ${
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div className="px-4 pb-3 pt-0.5 space-y-3">
              {keyInfo.length > 0 && (
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">
                    Key info
                  </p>
                  <div>
                    {keyInfo.map(row => (
                      <KeyInfoRow key={row.label} label={row.label} value={row.value} />
                    ))}
                  </div>
                </section>
              )}
              {highlights.length > 0 && (
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                    Profile highlights
                  </p>
                  <ul className="space-y-1">
                    {highlights.map((h, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-1.5 text-xs text-gray-700 leading-snug"
                      >
                        <Check className="w-3.5 h-3.5 text-emerald-600 mt-px flex-shrink-0" aria-hidden="true" />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
