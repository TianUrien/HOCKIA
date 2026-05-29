/**
 * analytics.ts — verifies the three trackEvent helpers that USED
 * to leak raw UUIDs now hash them before reaching GA.
 *
 * QA agent (2026-05-29) flagged ep.profile_id on the discovery
 * profile_view event as a critical PII leak. This file locks in
 * the fix and audits the adjacent vacancy events too — all three
 * now route their UUID-shaped params through hashId() before
 * passing to gtag.
 *
 * The functions return Promise<void> so tests can `await` them
 * directly. Production callers `void` the return — they don't need
 * to wait for the hash to finish before continuing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Capacitor mock — analytics module checks isNativePlatform.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}))

import {
  trackProfileView,
  trackVacancyView,
  trackApplicationSubmit,
} from '@/lib/analytics'
import { hashId } from '@/lib/analyticsSanitizers'

const PROFILE_UUID = '9a34cbdf-10f9-48f5-89d6-fc071db95c60'
const VACANCY_UUID = '38965930-2a53-47bf-85af-a0e9852c257b'

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).gtag = vi.fn()
})

describe('trackProfileView — was the QA-flagged critical leak', () => {
  it('hashes profileId into ep.profile_id (raw UUID never reaches gtag)', async () => {
    await trackProfileView('coach', PROFILE_UUID)
    const spy = window.gtag as unknown as ReturnType<typeof vi.fn>
    expect(spy).toHaveBeenCalled()
    const [, eventName, params] = spy.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(eventName).toBe('profile_view')
    expect(params.profile_id).toMatch(/^[0-9a-f]{16}$/)
    expect(params.profile_id).not.toBe(PROFILE_UUID)
    // role still passes through unhashed — that's deliberate.
    expect(params.event_label).toBe('coach')
  })

  it('hashed profile_id is deterministic across calls (preserves "unique profiles viewed" signal)', async () => {
    const expected = await hashId(PROFILE_UUID)
    await trackProfileView('coach', PROFILE_UUID)
    const spy = window.gtag as unknown as ReturnType<typeof vi.fn>
    const [, , params] = spy.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(params.profile_id).toBe(expected)
  })

  it('full UUID does NOT appear anywhere in gtag call args', async () => {
    await trackProfileView('coach', PROFILE_UUID)
    const spy = window.gtag as unknown as ReturnType<typeof vi.fn>
    const stringified = JSON.stringify(spy.mock.calls)
    expect(stringified).not.toContain(PROFILE_UUID)
    expect(stringified).not.toContain(PROFILE_UUID.slice(0, 8))
  })
})

describe('trackVacancyView', () => {
  it('hashes vacancyId into event_label (raw UUID never reaches gtag)', async () => {
    await trackVacancyView(VACANCY_UUID, 'goalkeeper', 'london')
    const spy = window.gtag as unknown as ReturnType<typeof vi.fn>
    expect(spy).toHaveBeenCalled()
    const [, eventName, params] = spy.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(eventName).toBe('vacancy_view')
    expect(params.event_label).toMatch(/^[0-9a-f]{16}$/)
    expect(params.event_label).not.toBe(VACANCY_UUID)
    // Other params pass through unhashed.
    expect(params.vacancy_position).toBe('goalkeeper')
    expect(params.vacancy_location).toBe('london')
  })

  it('full UUID does NOT appear anywhere in gtag call args', async () => {
    await trackVacancyView(VACANCY_UUID)
    const spy = window.gtag as unknown as ReturnType<typeof vi.fn>
    const stringified = JSON.stringify(spy.mock.calls)
    expect(stringified).not.toContain(VACANCY_UUID)
    expect(stringified).not.toContain(VACANCY_UUID.slice(0, 8))
  })
})

describe('trackApplicationSubmit', () => {
  it('hashes vacancyId into event_label', async () => {
    await trackApplicationSubmit(VACANCY_UUID, 'striker')
    const spy = window.gtag as unknown as ReturnType<typeof vi.fn>
    expect(spy).toHaveBeenCalled()
    const [, eventName, params] = spy.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(eventName).toBe('application_submit')
    expect(params.event_label).toMatch(/^[0-9a-f]{16}$/)
    expect(params.event_label).not.toBe(VACANCY_UUID)
    expect(params.vacancy_position).toBe('striker')
  })

  it('full UUID does NOT appear anywhere in gtag call args', async () => {
    await trackApplicationSubmit(VACANCY_UUID)
    const spy = window.gtag as unknown as ReturnType<typeof vi.fn>
    const stringified = JSON.stringify(spy.mock.calls)
    expect(stringified).not.toContain(VACANCY_UUID)
  })
})
