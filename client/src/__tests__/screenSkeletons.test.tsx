import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ActivityListSkeleton, ApplicantRowsSkeleton, ClubRoleCardSkeleton, ProfileSkeleton, RoleDetailSkeleton, ThreadSkeleton,
} from '@/components/ScreenSkeletons'

describe('layout-matched loading states (2026-10-21)', () => {
  it.each([
    ['role', <RoleDetailSkeleton key="r" />, 'role-detail-skeleton'],
    ['person profile', <ProfileSkeleton key="p" />, 'profile-skeleton'],
    ['club profile', <ProfileSkeleton key="c" variant="club" />, 'profile-skeleton'],
    ['activity', <ActivityListSkeleton key="a" />, 'activity-skeleton'],
    ['thread', <ThreadSkeleton key="t" />, 'thread-skeleton'],
    ['applicants', <ApplicantRowsSkeleton key="ap" />, 'applicants-skeleton'],
  ])('%s: a busy skeleton, never a spinner', (_name, node, testId) => {
    const { container } = render(node)
    const root = screen.getByTestId(testId)
    expect(root).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('person and club heroes keep the real hero heights (540 / 480)', () => {
    const { container, rerender } = render(<ProfileSkeleton />)
    expect(container.querySelector('.h-\\[540px\\]')).not.toBeNull()
    rerender(<ProfileSkeleton variant="club" />)
    expect(container.querySelector('.h-\\[480px\\]')).not.toBeNull()
  })

  it('pulses stop under reduced motion', () => {
    const { container } = render(<ClubRoleCardSkeleton />)
    const pulsing = Array.from(container.querySelectorAll('.animate-pulse'))
    expect(pulsing.length).toBeGreaterThan(0)
    for (const el of pulsing) expect(el.className).toContain('motion-reduce:animate-none')
  })

  it('the thread skeleton keeps a way back', async () => {
    const onBack = vi.fn()
    render(<ThreadSkeleton onBack={onBack} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back to conversations' }))
    expect(onBack).toHaveBeenCalled()
  })
})
