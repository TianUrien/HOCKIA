import { useMemo, useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { useCountries } from '@/hooks/useCountries'
import { searchCountries } from '@/lib/countrySearch'
import { guessCountry } from '@/lib/countryGuess'
import { Button } from '@/components/ui/Button'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { fieldInput } from '@/components/ui/fieldClasses'

const SNOOZE_DAYS = 14
const snoozeKey = (id: string) => `hockia-country-confirm-snooze-${id}`

function snoozed(id: string): boolean {
  try {
    const until = Number(localStorage.getItem(snoozeKey(id)) ?? 0)
    return until > Date.now()
  } catch {
    return false
  }
}

/**
 * Home card for members with no country on their profile (59% of members on
 * 2026-11-07): without one they never see opportunities, clubs or brand offers
 * picked by place. Proposes the country read from their location text; the
 * member confirms or picks another. Nothing is saved without the member
 * (founder ruling 2026-11-07).
 */
export function CountryConfirmCard() {
  const profile = useAuthStore((s) => s.profile)
  const refreshProfile = useAuthStore((s) => s.refreshProfile)
  const { countries } = useCountries()
  const [hidden, setHidden] = useState(false)
  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const eligible = Boolean(profile?.id) && profile?.base_country_id == null
    && ['player', 'coach', 'club', 'umpire'].includes(profile?.role ?? '')
  const guess = useMemo(() => (eligible ? guessCountry(profile?.base_location, countries) : null), [eligible, profile?.base_location, countries])
  const results = useMemo(() => searchCountries(countries, q).slice(0, 80), [countries, q])

  if (!eligible || hidden || !profile || snoozed(profile.id)) return null

  const save = async (countryId: number) => {
    setSaving(true)
    setFailed(false)
    const { error } = await supabase.from('profiles').update({ base_country_id: countryId }).eq('id', profile.id)
    if (error) {
      logger.error('[CountryConfirmCard] save failed', error)
      setFailed(true)
      setSaving(false)
      return
    }
    setPicking(false)
    await refreshProfile()
    setHidden(true)
  }
  const later = () => {
    try { localStorage.setItem(snoozeKey(profile.id), String(Date.now() + SNOOZE_DAYS * 86_400_000)) } catch { /* private mode: hide for this visit only */ }
    setHidden(true)
  }
  const place = profile.base_location?.trim()

  return (
    <section className="mx-4 mt-3 rounded-[20px] border border-line bg-white p-4" aria-labelledby="country-confirm-title" data-testid="country-confirm">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-primary">
          <MapPin className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="country-confirm-title" className="text-body font-semibold text-ink-1">Which country are you based in?</h2>
          <p className="mt-0.5 text-row text-ink-2">
            {place ? `Your profile says ${place}. ` : ''}Add your country so opportunities, clubs and offers near you can find you.
          </p>
        </div>
      </div>
      {failed ? <p className="mt-3 text-row text-ink-2" role="alert">That didn’t save. Check your connection and try again.</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {guess ? (
          <Button size="small" loading={saving && !picking} onClick={() => void save(guess.id)} data-testid="country-confirm-yes">
            Yes, {guess.common_name || guess.name}
          </Button>
        ) : null}
        <Button size="small" variant={guess ? 'secondary' : 'primary'} onClick={() => setPicking(true)} data-testid="country-confirm-choose">
          {guess ? 'Choose another' : 'Choose your country'}
        </Button>
        <Button size="small" variant="tertiary" onClick={later} data-testid="country-confirm-later">Not now</Button>
      </div>

      <BottomSheet open={picking} onClose={() => { setPicking(false); setQ('') }} ariaLabel="Choose your country">
        <div className="px-5 pb-3 pt-1">
          <h2 className="text-title text-ink-1">Choose your country</h2>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search countries" aria-label="Search countries" className={cn(fieldInput, 'pl-10')} />
          </div>
        </div>
        <ul className="max-h-[50dvh] overflow-y-auto px-2 pb-3">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" disabled={saving} onClick={() => void save(c.id)} className="flex h-12 w-full items-center rounded-[12px] px-3 text-left text-body text-ink-1 active:bg-surface-muted">
                {c.common_name || c.name}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </section>
  )
}
