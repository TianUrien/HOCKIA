/**
 * Design audit 2026-10-21, A9: honest offline states on Community. A read
 * that never reached HOCKIA fails (never pauses on skeletons), shows the
 * app's network line + Try again, keeps loaded content, and the heading and
 * skeleton shape follow the selected tab.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CommunitySkeletons } from '@/components/community/CommunitySkeletons'
import { skeletonKindFor } from '@/lib/communitySkeleton'
import { NETWORK_ERROR_COPY, couldntLoadTitle } from '@/lib/networkCopy'

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('Community offline', () => {
  it('one network line for the role page, sign-in and Community', () => {
    expect(NETWORK_ERROR_COPY).toBe('Couldn’t reach HOCKIA. Check your connection and try again.')
    expect(src('pages/OpportunityDetailPage.tsx')).toContain("from '@/lib/networkCopy'")
    expect(src('pages/AuthScreen.tsx')).toContain("from '@/lib/networkCopy'")
    expect(src('components/community/PeopleListView.tsx')).toContain('{NETWORK_ERROR_COPY}')
  })

  it('the error title follows the tab', () => {
    expect(couldntLoadTitle('club')).toBe('Couldn’t load clubs')
    expect(couldntLoadTitle('brand')).toBe('Couldn’t load brands')
    expect(couldntLoadTitle(undefined)).toBe('Couldn’t load members')
  })

  it('member reads fail offline instead of pausing on skeletons forever', () => {
    const s = src('components/community/PeopleListView.tsx')
    expect(s.match(/networkMode: 'always'/g)?.length).toBe(3)
    // A desktop error state exists too (it used to be phone only).
    expect(s).toContain('data-testid="community-load-failed"')
  })

  it('the heading follows the selected tab on desktop too', () => {
    expect(src('pages/CommunityPage.tsx')).toContain("activeTab === 'all' ? 'All members' : TITLE_BY_TAB[activeTab]")
  })

  it.each([
    ['club', 'club-card-skeleton'],
    ['brand', 'brand-card-skeleton'],
    ['player', 'member-tile-skeleton'],
  ] as const)('the %s tab loads with its own skeleton shape', (role, testId) => {
    expect(skeletonKindFor(role)).toBe(role === 'player' ? 'person' : role)
    render(<CommunitySkeletons kind={skeletonKindFor(role)} layout="phone" />)
    expect(screen.getAllByTestId(testId).length).toBeGreaterThan(0)
  })
})
