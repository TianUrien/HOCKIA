import {
  FRESHNESS_THRESHOLDS,
  pickFreshnessNudge,
  type FreshnessSignals,
} from '@/lib/profileFreshness'

// Helper: build an ISO timestamp N days before a fixed "now" reference so
// the same assertion produces the same daysSince regardless of when tests run.
const NOW = new Date('2026-04-20T12:00:00.000Z')
const daysAgo = (n: number): string =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

describe('pickFreshnessNudge', () => {
  describe('null / empty inputs', () => {
    it('returns null when the role has no relevant signals', () => {
      expect(pickFreshnessNudge('player', {}, NOW)).toBeNull()
    })

    it('returns null when every section is still fresh', () => {
      const signals: FreshnessSignals = {
        lastJourneyAt: daysAgo(5),
        lastGalleryAt: daysAgo(10),
      }
      expect(pickFreshnessNudge('player', signals, NOW)).toBeNull()
    })

    it('treats a null last-updated timestamp as proof-of-empty and skips the section', () => {
      const signals: FreshnessSignals = {
        lastJourneyAt: null,
        lastGalleryAt: null,
      }
      expect(pickFreshnessNudge('player', signals, NOW)).toBeNull()
    })
  })

  describe('player', () => {
    it('nudges Journey when it is past the 30-day threshold', () => {
      const nudge = pickFreshnessNudge(
        'player',
        { lastJourneyAt: daysAgo(45), lastGalleryAt: daysAgo(5) },
        NOW
      )
      expect(nudge).not.toBeNull()
      expect(nudge?.id).toBe('journey-stale')
      expect(nudge?.daysSince).toBe(45)
    })

    it('does not nudge Journey just before the threshold', () => {
      expect(
        pickFreshnessNudge('player', { lastJourneyAt: daysAgo(FRESHNESS_THRESHOLDS['journey-stale'] - 1) }, NOW)
      ).toBeNull()
    })

    it('nudges Journey exactly at the threshold', () => {
      const nudge = pickFreshnessNudge(
        'player',
        { lastJourneyAt: daysAgo(FRESHNESS_THRESHOLDS['journey-stale']) },
        NOW
      )
      expect(nudge?.id).toBe('journey-stale')
    })

    it('prioritises the most-stale section when multiple are over threshold', () => {
      // Journey threshold=30, Gallery threshold=45. Both are stale; Gallery
      // is older, so Gallery should win.
      const nudge = pickFreshnessNudge(
        'player',
        { lastJourneyAt: daysAgo(50), lastGalleryAt: daysAgo(120) },
        NOW
      )
      expect(nudge?.id).toBe('gallery-stale')
      expect(nudge?.daysSince).toBe(120)
    })

    it('does not nudge about a section the role does not own (e.g. posts for player)', () => {
      expect(
        pickFreshnessNudge(
          'player',
          { lastPostAt: daysAgo(180), lastJourneyAt: daysAgo(5) },
          NOW
        )
      ).toBeNull()
    })

    it('humanises the time-ago phrase based on daysSince', () => {
      const nudgeDays = pickFreshnessNudge('player', { lastJourneyAt: daysAgo(31) }, NOW)
      // 31 days rounds to 4 weeks — between 2 and 8 weeks uses the "weeks" unit
      expect(nudgeDays?.message).toMatch(/4 weeks ago/)

      const nudgeMonths = pickFreshnessNudge('player', { lastJourneyAt: daysAgo(180) }, NOW)
      // 180 days → 6 months
      expect(nudgeMonths?.message).toMatch(/6 months ago/)
    })
  })

  describe('coach', () => {
    it('includes bio staleness as a considered signal', () => {
      const nudge = pickFreshnessNudge(
        'coach',
        { lastBioAt: daysAgo(200) },
        NOW
      )
      expect(nudge?.id).toBe('bio-stale')
    })

    it('does not nudge on bio until past the 180-day threshold', () => {
      expect(
        pickFreshnessNudge('coach', { lastBioAt: daysAgo(170) }, NOW)
      ).toBeNull()
    })
  })

  describe('brand', () => {
    it('nudges posts before products when posts are older', () => {
      const nudge = pickFreshnessNudge(
        'brand',
        { lastPostAt: daysAgo(60), lastProductAt: daysAgo(35) },
        NOW
      )
      expect(nudge?.id).toBe('posts-stale')
    })

    it('nudges products when posts are fresh but products are stale', () => {
      const nudge = pickFreshnessNudge(
        'brand',
        { lastPostAt: daysAgo(3), lastProductAt: daysAgo(60) },
        NOW
      )
      expect(nudge?.id).toBe('products-stale')
    })
  })

  describe('club', () => {
    it('nudges club media when it is past the 45-day threshold', () => {
      const nudge = pickFreshnessNudge(
        'club',
        { lastMediaAt: daysAgo(60) },
        NOW
      )
      expect(nudge?.id).toBe('media-stale')
    })
  })

  it('returns null for an unknown role', () => {
    expect(
      pickFreshnessNudge(
        'alien' as unknown as 'player',
        { lastJourneyAt: daysAgo(500) },
        NOW
      )
    ).toBeNull()
  })

  it('tolerates malformed ISO strings by reporting 0 daysSince (no nudge)', () => {
    expect(
      pickFreshnessNudge('player', { lastJourneyAt: 'not-a-date' }, NOW)
    ).toBeNull()
  })
})
