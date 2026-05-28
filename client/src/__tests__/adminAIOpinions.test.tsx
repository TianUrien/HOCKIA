/**
 * AdminAIOpinions — page render contract.
 *
 * Confirms:
 *   - The page mounts, fetches both endpoints, and surfaces the
 *     headline metrics + feedback rows.
 *   - Day filter and rating filter both trigger a refetch with the
 *     expected param.
 *   - Empty states render when the RPCs return no data.
 *
 * SQL behavior of the underlying RPCs is verified by smoke + staging
 * QA — here we only assert the client-side wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const { getMetricsSpy, getFeedbackSpy } = vi.hoisted(() => ({
  getMetricsSpy: vi.fn(),
  getFeedbackSpy: vi.fn(),
}))

vi.mock('@/features/admin/api/adminApi', () => ({
  getAIOpinionMetrics: getMetricsSpy,
  getRecentAIOpinionFeedback: getFeedbackSpy,
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// Stub the role color helper so the test doesn't need to load the
// real module (which can pull in the auth store, etc).
vi.mock('@/lib/roleColors', () => ({
  getRoleBadgeClasses: () => 'role-badge',
}))

// Stub recharts so tests don't try to measure responsive container
// dimensions in a happy-dom env.
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return {
    ResponsiveContainer: Stub,
    LineChart: Stub,
    Line: Stub,
    BarChart: Stub,
    Bar: Stub,
    XAxis: Stub,
    YAxis: Stub,
    CartesianGrid: Stub,
    Tooltip: Stub,
    Legend: Stub,
  }
})

import { AdminAIOpinions } from '@/features/admin/pages/AdminAIOpinions'

const mockMetrics = {
  summary: {
    total_fresh_generations: 42,
    unique_recruiters: 7,
    unique_players_evaluated: 23,
    still_fresh_count: 18,
  },
  daily: [
    { day: '2026-05-28', generations: 12 },
    { day: '2026-05-29', generations: 30 },
  ],
  by_version: [
    { prompt_version: 'v1.2', generations: 30 },
    { prompt_version: 'v1.1', generations: 12 },
  ],
  by_model: [{ model: 'claude-sonnet-4-6', generations: 42 }],
  feedback: {
    total_rated: 10,
    up_count: 7,
    down_count: 3,
    down_with_reason: 2,
    by_version: [
      { prompt_version: 'v1.2', up_count: 6, down_count: 1 },
      { prompt_version: 'v1.1', up_count: 1, down_count: 2 },
    ],
  },
  top_recruiters: [
    {
      viewer_id: 'viewer-1',
      viewer_name: 'E2E Test FC',
      viewer_role: 'club',
      generations: 25,
    },
  ],
  window_days: 30,
  generated_at: '2026-05-29T12:00:00Z',
}

const mockFeedbackPage = {
  rows: [
    {
      feedback_id: 'fb-1',
      rating: 'down' as const,
      reason: 'level comparison was inverted',
      feedback_created_at: '2026-05-29T11:30:00Z',
      feedback_updated_at: '2026-05-29T11:30:00Z',
      opinion_id: 'op-1',
      verdict_short: 'verdict text here',
      citations: [{ field: 'competition_level_band', value: '3', claim: 'matches tier' }],
      prompt_version: 'v1.2',
      model: 'claude-sonnet-4-6',
      opinion_created_at: '2026-05-29T11:25:00Z',
      viewer_id: 'viewer-1',
      viewer_name: 'E2E Test FC',
      viewer_role: 'club',
      player_id: 'player-1',
      player_name: 'Valentina Turienzo',
      player_role: 'player',
    },
    {
      feedback_id: 'fb-2',
      rating: 'up' as const,
      reason: null,
      feedback_created_at: '2026-05-29T10:00:00Z',
      feedback_updated_at: '2026-05-29T10:00:00Z',
      opinion_id: 'op-2',
      verdict_short: 'another verdict',
      citations: [],
      prompt_version: 'v1.2',
      model: 'claude-sonnet-4-6',
      opinion_created_at: '2026-05-29T09:55:00Z',
      viewer_id: 'viewer-1',
      viewer_name: 'E2E Test FC',
      viewer_role: 'club',
      player_id: 'player-2',
      player_name: 'Tian Admin',
      player_role: 'player',
    },
  ],
  total: 2,
  limit: 25,
  offset: 0,
  rating_filter: null,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminAIOpinions />
    </MemoryRouter>,
  )
}

describe('AdminAIOpinions', () => {
  beforeEach(() => {
    cleanup()
    getMetricsSpy.mockReset()
    getFeedbackSpy.mockReset()
    getMetricsSpy.mockResolvedValue(mockMetrics)
    getFeedbackSpy.mockResolvedValue(mockFeedbackPage)
  })

  it('mounts, calls both RPCs with default args, and renders headline metrics', async () => {
    renderPage()

    await waitFor(() => {
      expect(getMetricsSpy).toHaveBeenCalledWith(30)
      expect(getFeedbackSpy).toHaveBeenCalledWith({ limit: 25, offset: 0, rating: null })
    })

    // StatCard labels prove the cards rendered with data, more robust
    // than asserting raw numbers (which collide with "Last 7 days",
    // pagination counts, etc.)
    expect(await screen.findByText(/Fresh generations/)).toBeInTheDocument()
    expect(screen.getByText(/Unique recruiters/)).toBeInTheDocument()
    expect(screen.getByText(/Players evaluated/)).toBeInTheDocument()
    expect(screen.getByText(/Still cached/)).toBeInTheDocument()
    // Confirm one of the unambiguous numbers actually rendered.
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('23')).toBeInTheDocument()
  })

  it('renders feedback rows with viewer/player names and reason text', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getAllByTestId('admin-feedback-row')).toHaveLength(2)
    })
    expect(screen.getByText(/"level comparison was inverted"/)).toBeInTheDocument()
    expect(screen.getByText(/No reason provided/)).toBeInTheDocument()
    expect(screen.getAllByText('E2E Test FC').length).toBeGreaterThan(0)
    expect(screen.getByText('Valentina Turienzo')).toBeInTheDocument()
    expect(screen.getByText('Tian Admin')).toBeInTheDocument()
  })

  it('changing days filter re-calls getAIOpinionMetrics with the new window', async () => {
    renderPage()
    await waitFor(() => expect(getMetricsSpy).toHaveBeenCalledWith(30))

    // The header has a <select> with 7 / 30 / 90 options.
    const select = screen.getByRole('combobox')
    await userEvent.selectOptions(select, '7')

    await waitFor(() => {
      expect(getMetricsSpy).toHaveBeenCalledWith(7)
    })
  })

  it('changing rating filter to "down" re-calls feedback RPC with rating=down and resets offset', async () => {
    renderPage()
    await waitFor(() => expect(getFeedbackSpy).toHaveBeenCalledWith({ limit: 25, offset: 0, rating: null }))

    await userEvent.click(screen.getByRole('button', { name: /Down/i }))

    await waitFor(() => {
      expect(getFeedbackSpy).toHaveBeenCalledWith({ limit: 25, offset: 0, rating: 'down' })
    })
  })

  it('renders an empty state when feedback RPC returns zero rows', async () => {
    getFeedbackSpy.mockResolvedValue({ rows: [], total: 0, limit: 25, offset: 0, rating_filter: null })
    renderPage()
    expect(await screen.findByText(/No feedback matches this filter/i)).toBeInTheDocument()
  })

  it('surfaces an error banner if the metrics RPC throws', async () => {
    getMetricsSpy.mockRejectedValue(new Error('Unauthorized'))
    renderPage()
    expect(await screen.findByText(/Unauthorized/)).toBeInTheDocument()
  })
})
