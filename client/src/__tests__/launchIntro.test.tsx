/**
 * Splash intro (founder 2026-10-26): native only, first launch after install
 * or update, never with Reduce Motion.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = { current: true }
const version = { current: { version: '1.4.0', build: '40' } as { version: string; build: string } | null }
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.current, getPlatform: () => 'ios' } }))
vi.mock('@/lib/appVersion', () => ({ getAppVersion: () => Promise.resolve(version.current) }))

import LaunchIntro from '@/components/LaunchIntro'

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('LaunchIntro', () => {
  beforeEach(() => {
    localStorage.clear()
    native.current = true
    version.current = { version: '1.4.0', build: '40' }
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  })

  it('renders nothing on the web', () => {
    native.current = false
    render(<LaunchIntro />)
    expect(screen.queryByTestId('launch-intro')).toBeNull()
  })

  it('renders nothing with Reduce Motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
    render(<LaunchIntro />)
    expect(screen.queryByTestId('launch-intro')).toBeNull()
  })

  it('first launch of a version: plays and remembers the version', async () => {
    render(<LaunchIntro />)
    expect(screen.getByTestId('launch-intro')).toBeInTheDocument()
    await flush()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    expect(localStorage.getItem('hockia-splash-intro-seen')).toBe('1.4.0+40')
  })

  it('same version again: does not play, fades out', async () => {
    localStorage.setItem('hockia-splash-intro-seen', '1.4.0+40')
    render(<LaunchIntro />)
    await flush()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(screen.getByTestId('launch-intro')).toHaveStyle({ opacity: '0' })
  })

  it('after an update: plays again', async () => {
    localStorage.setItem('hockia-splash-intro-seen', '1.3.22+35')
    render(<LaunchIntro />)
    await flush()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('an unplayable <source> (HEVC on Android) does not end the intro; a real media error does', async () => {
    const { container } = render(<LaunchIntro />)
    await flush()
    const video = container.querySelector('video') as HTMLVideoElement
    fireEvent.error(video)
    expect(screen.getByTestId('launch-intro')).toHaveStyle({ opacity: '1' })
    Object.defineProperty(video, 'error', { value: { code: 4 }, configurable: true })
    fireEvent.error(video)
    expect(screen.getByTestId('launch-intro')).toHaveStyle({ opacity: '0' })
  })
})
