/**
 * Key facts (D2 · 30-second profile) — the six tiles a club reads first.
 * Covers the three viewer modes, every "not given" path, the self-reported
 * league label (and that it never reaches fit), EU yes/no, the recruiter-only
 * permit line, and the coach variant.
 */
import { describe, expect, it } from 'vitest'
import {
  NOT_GIVEN,
  NOT_SET,
  buildCoachKeyFacts,
  buildPlayerKeyFacts,
  countFilledKeyFacts,
  formatDay,
  formatMonth,
  levelBandForFit,
  type PlayerKeyFactsInput,
} from '@/lib/keyFacts'
import { computeClubFit } from '@/lib/clubFit'

const TODAY = new Date('2026-09-26T12:00:00Z')

const leandro: PlayerKeyFactsInput = {
  position: 'Midfielder',
  secondaryPosition: 'Defender',
  currentClubName: 'Old Lions Rugby Club',
  league: null,
  availableFrom: null,
  availabilityDuration: 'full_season',
  passports: [{ name: 'Argentina', flag: '🇦🇷', isEu: false }],
  permits: [],
  fullMatchCount: 1,
  highlightCount: 4,
  age: 25,
}

const byId = <T extends { id: string }>(facts: T[], id: string) => {
  const f = facts.find((x) => x.id === id)
  if (!f) throw new Error(`missing fact ${id}`)
  return f
}

describe('buildPlayerKeyFacts — club view (Figma D2.1)', () => {
  const facts = buildPlayerKeyFacts(leandro, { viewer: 'recruiter', today: TODAY })

  it('returns the six facts in display order', () => {
    expect(facts.map((f) => f.id)).toEqual(['position', 'plays_at', 'available', 'passport', 'video', 'age'])
  })

  it('position joins primary and secondary', () => {
    expect(byId(facts, 'position').value).toBe('Midfielder · Defender')
  })

  it('plays at shows the club with "League not given" when there is no league', () => {
    const f = byId(facts, 'plays_at')
    expect(f.value).toBe('Old Lions Rugby Club')
    expect(f.detail).toBe('League not given')
    expect(f.detailMissing).toBe(true)
    expect(f.action).toBeNull()
  })

  it('available shows the length with "Start date not given"', () => {
    const f = byId(facts, 'available')
    expect(f.value).toBe('Full season')
    expect(f.detail).toBe('Start date not given')
  })

  it('passport shows flag + country and EU yes/no', () => {
    const f = byId(facts, 'passport')
    expect(f.value).toBe('🇦🇷 Argentina')
    expect(f.detail).toBe('No EU passport')
  })

  it('video counts full matches and highlights with plurals', () => {
    expect(byId(facts, 'video').value).toBe('1 full match · 4 highlights')
  })

  it('age is a plain number', () => {
    expect(byId(facts, 'age').value).toBe('25')
  })

  it('never offers Add actions to a non-owner', () => {
    expect(facts.every((f) => f.action === null)).toBe(true)
  })
})

describe('buildPlayerKeyFacts — owner view (Figma D2.2)', () => {
  const facts = buildPlayerKeyFacts(leandro, { viewer: 'owner', today: TODAY })

  it('league gap reads "League not set" with Add league', () => {
    const f = byId(facts, 'plays_at')
    expect(f.detail).toBe('League not set')
    expect(f.action).toBe('add_league')
  })

  it('date gap reads "No start date" with Add date', () => {
    const f = byId(facts, 'available')
    expect(f.detail).toBe('No start date')
    expect(f.action).toBe('add_date')
  })

  it('one passport offers "Add another"', () => {
    expect(byId(facts, 'passport').action).toBe('add_passport')
  })

  it('two passports: no Add action, extra passports are ignored (max 2)', () => {
    const f = byId(
      buildPlayerKeyFacts(
        {
          ...leandro,
          passports: [
            { name: 'Argentina', flag: '🇦🇷', isEu: false },
            { name: 'Italy', flag: '🇮🇹', isEu: true },
            { name: 'Spain', flag: '🇪🇸', isEu: true },
          ],
        },
        { viewer: 'owner', today: TODAY },
      ),
      'passport',
    )
    expect(f.value).toBe('🇦🇷 Argentina · 🇮🇹 Italy')
    expect(f.detail).toBe('EU passport')
    expect(f.action).toBeNull()
  })
})

describe('missing facts', () => {
  const empty: PlayerKeyFactsInput = {
    position: '  ',
    secondaryPosition: null,
    currentClubName: null,
    league: null,
    availableFrom: null,
    availabilityDuration: null,
    passports: [],
    fullMatchCount: 0,
    highlightCount: 0,
    age: null,
  }

  it('club / public viewers see "Not given" everywhere', () => {
    for (const viewer of ['recruiter', 'public'] as const) {
      const facts = buildPlayerKeyFacts(empty, { viewer, today: TODAY })
      expect(facts.every((f) => f.missing && f.value === NOT_GIVEN && f.action === null)).toBe(true)
      expect(countFilledKeyFacts(facts)).toBe(0)
    }
  })

  it('the owner sees "Not set" and the matching Add action (age has none: DOB is set once)', () => {
    const facts = buildPlayerKeyFacts(empty, { viewer: 'owner', today: TODAY })
    expect(facts.every((f) => f.value === NOT_SET)).toBe(true)
    expect(facts.map((f) => f.action)).toEqual([
      'add_position', 'add_club', 'add_availability', 'add_passport', 'add_video', null,
    ])
  })

  it('zero / negative / NaN counts and ages are treated as missing', () => {
    const facts = buildPlayerKeyFacts(
      { ...empty, fullMatchCount: -1, highlightCount: Number.NaN, age: 0 },
      { viewer: 'recruiter', today: TODAY },
    )
    expect(byId(facts, 'video').missing).toBe(true)
    expect(byId(facts, 'age').missing).toBe(true)
  })

  it('a duplicated secondary position is shown once', () => {
    const f = byId(
      buildPlayerKeyFacts({ ...leandro, secondaryPosition: 'midfielder' }, { viewer: 'public', today: TODAY }),
      'position',
    )
    expect(f.value).toBe('Midfielder')
  })
})

describe('league: club league vs self-reported', () => {
  it('a club league is shown plainly', () => {
    const f = byId(
      buildPlayerKeyFacts({ ...leandro, league: { name: 'Súper Liga B', source: 'club', levelBand: 6 } }, { viewer: 'recruiter', today: TODAY }),
      'plays_at',
    )
    expect(f.detail).toBe('Súper Liga B')
    expect(f.badge).toBeNull()
    expect(f.detailMissing).toBe(false)
  })

  it('a self-reported league is shown and labelled', () => {
    const f = byId(
      buildPlayerKeyFacts({ ...leandro, league: { name: 'Torneo Regional NOA B', source: 'self_reported' } }, { viewer: 'recruiter', today: TODAY }),
      'plays_at',
    )
    expect(f.detail).toBe('Torneo Regional NOA B · self-reported')
    expect(f.badge).toBe('self_reported')
    expect(f.action).toBeNull()
  })

  it('a self-reported league with no club still shows, labelled', () => {
    const f = byId(
      buildPlayerKeyFacts(
        { ...leandro, currentClubName: null, league: { name: 'Torneo Regional NOA B', source: 'self_reported' } },
        { viewer: 'public', today: TODAY },
      ),
      'plays_at',
    )
    expect(f.value).toBe('Torneo Regional NOA B')
    expect(f.detail).toBe('self-reported')
    expect(f.missing).toBe(false)
  })

  it('levelBandForFit ignores self-reported leagues (founder ruling 2026-09-26)', () => {
    expect(levelBandForFit({ name: 'X', source: 'self_reported', levelBand: 7 })).toBeNull()
    expect(levelBandForFit({ name: 'X', source: 'club', levelBand: 7 })).toBe(7)
    expect(levelBandForFit({ name: 'X', source: 'club' })).toBeNull()
    expect(levelBandForFit(null)).toBeNull()
  })

  it('a self-reported league never moves Club Fit', () => {
    const viewer = {
      role: 'club' as const,
      womens_league_division: null,
      mens_league_division: 'Division 1',
      current_world_club_id: 'club-1',
      competition_level_band: 6,
    }
    const candidate = {
      id: 'p1',
      role: 'player' as const,
      playing_category: 'adult_men',
      current_world_club_id: 'wc-no-league',
      open_to_play: true,
      open_to_coach: null,
      open_to_opportunities: null,
      last_active_at: TODAY.toISOString(),
    }
    const without = computeClubFit(viewer, { ...candidate, competition_level_band: null })
    const withSelfReported = computeClubFit(viewer, {
      ...candidate,
      competition_level_band: levelBandForFit({ name: 'Division 1', source: 'self_reported', levelBand: 6 }),
    })
    expect(withSelfReported.score).toBe(without.score)
    expect(withSelfReported.components.competition_proximity).toBe(0)
  })
})

describe('availability', () => {
  it('a future start date reads "From <date>" under the length', () => {
    const f = byId(
      buildPlayerKeyFacts({ ...leandro, availableFrom: '2027-01-12' }, { viewer: 'recruiter', today: TODAY }),
      'available',
    )
    expect(f.value).toBe('Full season')
    expect(f.detail).toBe('From 12 Jan 2027')
    expect(f.action).toBeNull()
  })

  it('a past or today start date reads "Available now"', () => {
    for (const d of ['2026-09-26', '2026-01-01']) {
      const f = byId(buildPlayerKeyFacts({ ...leandro, availableFrom: d }, { viewer: 'owner', today: TODAY }), 'available')
      expect(f.detail).toBe('Available now')
    }
  })

  it('a date without a length becomes the main line', () => {
    const f = byId(
      buildPlayerKeyFacts({ ...leandro, availabilityDuration: null, availableFrom: '2027-03-01' }, { viewer: 'recruiter', today: TODAY }),
      'available',
    )
    expect(f.value).toBe('From 1 Mar 2027')
    expect(f.detail).toBeNull()
  })

  it('an unknown duration code is ignored', () => {
    const f = byId(
      buildPlayerKeyFacts({ ...leandro, availabilityDuration: 'forever' }, { viewer: 'recruiter', today: TODAY }),
      'available',
    )
    expect(f.missing).toBe(true)
  })
})

describe('permits on the passport tile', () => {
  const permits = [
    { countryName: 'United Kingdom', flag: '🇬🇧', type: 'visa', validFrom: null, expiresOn: '2027-03-31' },
    { countryName: 'Australia', flag: '🇦🇺', type: 'work_permit', validFrom: null, expiresOn: '2026-10-10' },
    { countryName: 'Ireland', flag: '🇮🇪', type: 'residency', validFrom: null, expiresOn: '2026-01-31' },
    { countryName: 'New Zealand', flag: '🇳🇿', type: 'visa', validFrom: '2027-01-01', expiresOn: '2027-12-31' },
  ]
  const input = { ...leandro, permits }

  it('recruiters see valid permits only (incl. expiring soon), no status', () => {
    const f = byId(buildPlayerKeyFacts(input, { viewer: 'recruiter', today: TODAY }), 'passport')
    expect(f.extraLines).toEqual([
      { text: '🇬🇧 United Kingdom · Visa · until Mar 2027' },
      { text: '🇦🇺 Australia · Work permit · until Oct 2026' },
    ])
  })

  it('public viewers never see permit detail', () => {
    const f = byId(buildPlayerKeyFacts(input, { viewer: 'public', today: TODAY }), 'passport')
    expect(f.extraLines).toEqual([])
    expect(f.value).toBe('🇦🇷 Argentina')
  })

  it('the owner sees every permit with its status (amber for expiring soon / expired)', () => {
    const f = byId(buildPlayerKeyFacts(input, { viewer: 'owner', today: TODAY }), 'passport')
    expect(f.extraLines.map((l) => l.status)).toEqual(['valid', 'expiring_soon', 'expired', 'not_yet_valid'])
    expect(f.extraLines[2].text).toBe('🇮🇪 Ireland · Residency · expired Jan 2026')
  })

  it('permits never change the EU line (shown, not enforced)', () => {
    const f = byId(buildPlayerKeyFacts(input, { viewer: 'recruiter', today: TODAY }), 'passport')
    expect(f.detail).toBe('No EU passport')
  })

  it('a permit still shows for recruiters when no passport is given', () => {
    const f = byId(buildPlayerKeyFacts({ ...input, passports: [] }, { viewer: 'recruiter', today: TODAY }), 'passport')
    expect(f.missing).toBe(true)
    expect(f.value).toBe(NOT_GIVEN)
    expect(f.extraLines).toHaveLength(2)
  })
})

describe('buildCoachKeyFacts', () => {
  const coach = {
    specialization: 'head_coach',
    categories: ['adult_women', 'girls'],
    currentRole: 'Head coach',
    currentClubName: 'Belgrano AC',
    openToCoach: true,
    availableFrom: null,
    passports: [{ name: 'Spain', flag: '🇪🇸', isEu: true }],
    age: 41,
  }

  it('returns the six coach facts in order', () => {
    const facts = buildCoachKeyFacts(coach, { viewer: 'recruiter', today: TODAY })
    expect(facts.map((f) => f.id)).toEqual(['specialization', 'categories', 'current_role', 'available', 'passport', 'age'])
    expect(byId(facts, 'specialization').value).toBe('Head Coach')
    expect(byId(facts, 'categories').value).toBe('Adult Women, Girls')
    expect(byId(facts, 'current_role').value).toBe('Head coach')
    expect(byId(facts, 'current_role').detail).toBe('Belgrano AC')
    expect(byId(facts, 'available').value).toBe('Open to coach')
    expect(byId(facts, 'available').detail).toBe('Start date not given')
    expect(byId(facts, 'passport').detail).toBe('EU passport')
    expect(byId(facts, 'age').value).toBe('41')
  })

  it('custom specialization and "any" categories', () => {
    const facts = buildCoachKeyFacts(
      { ...coach, specialization: 'other', specializationCustom: 'Drag-flick coach', categories: ['any'] },
      { viewer: 'public', today: TODAY },
    )
    expect(byId(facts, 'specialization').value).toBe('Drag-flick coach')
    expect(byId(facts, 'categories').value).toBe('Any category')
  })

  it('missing coach facts: "Not given" for others, "Not set" + actions for the owner', () => {
    const empty = {
      specialization: null,
      categories: [],
      currentRole: null,
      currentClubName: null,
      openToCoach: false,
      availableFrom: null,
      passports: [],
      age: null,
    }
    const others = buildCoachKeyFacts(empty, { viewer: 'recruiter', today: TODAY })
    expect(others.every((f) => f.value === NOT_GIVEN)).toBe(true)
    const owner = buildCoachKeyFacts(empty, { viewer: 'owner', today: TODAY })
    expect(owner.map((f) => f.action)).toEqual([
      'add_specialization', 'add_categories', 'add_current_role', 'add_availability', 'add_passport', null,
    ])
  })

  it('a start date wins over the plain open-to-coach line', () => {
    const f = byId(buildCoachKeyFacts({ ...coach, availableFrom: '2027-02-01' }, { viewer: 'owner', today: TODAY }), 'available')
    expect(f.value).toBe('From 1 Feb 2027')
  })
})

describe('date formatting', () => {
  it('formats UTC calendar dates without timezone drift', () => {
    expect(formatDay('2027-01-01')).toBe('1 Jan 2027')
    expect(formatDay('2026-12-31T23:30:00-05:00')).toBe('31 Dec 2026')
    expect(formatMonth('2027-03-31')).toBe('Mar 2027')
  })

  it('rejects junk', () => {
    expect(formatDay(null)).toBeNull()
    expect(formatDay('not a date')).toBeNull()
    expect(formatDay('2026-13-01')).toBeNull()
  })
})
