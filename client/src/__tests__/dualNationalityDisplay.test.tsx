/**
 * DualNationalityDisplay — render-mode tests.
 *
 * The Community redesign relies on `mode="tile"` to surface BOTH names
 * for dual-nationality users. These tests pin the tile-mode contract so a
 * future refactor can't silently regress to flags-only.
 */

import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({
    countries: [],
    loading: false,
    error: null,
    getCountryById: (id: number | null) => {
      if (id === 10)
        return {
          id: 10,
          code: 'nl',
          code_alpha3: 'NLD',
          name: 'Netherlands',
          common_name: null,
          nationality_name: 'Dutch',
          region: 'Europe',
          flag_emoji: '🇳🇱',
        }
      if (id === 20)
        return {
          id: 20,
          code: 'ar',
          code_alpha3: 'ARG',
          name: 'Argentina',
          common_name: null,
          nationality_name: 'Argentinian',
          region: 'Americas',
          flag_emoji: '🇦🇷',
        }
      if (id === 30)
        return {
          id: 30,
          code: 'fr',
          code_alpha3: 'FRA',
          name: 'France',
          common_name: null,
          nationality_name: 'French',
          region: 'Europe',
          flag_emoji: '🇫🇷',
        }
      return undefined
    },
    getCountryByCode: () => undefined,
    isEuCountry: (id: number | null) => id === 10 || id === 30,
  }),
}))

import DualNationalityDisplay from '@/components/DualNationalityDisplay'

describe('DualNationalityDisplay — tile mode', () => {
  it('returns null when no country IDs and no fallback text', () => {
    const { container } = render(
      <DualNationalityDisplay
        primaryCountryId={null}
        secondaryCountryId={null}
        fallbackText={null}
        mode="tile"
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders fallback text when no country IDs but text given', () => {
    render(
      <DualNationalityDisplay
        primaryCountryId={null}
        secondaryCountryId={null}
        fallbackText="Argentinian"
        mode="tile"
      />,
    )
    expect(screen.getByText('Argentinian')).toBeInTheDocument()
  })

  it('renders single nationality with flag + full name', () => {
    render(
      <DualNationalityDisplay
        primaryCountryId={20}
        secondaryCountryId={null}
        mode="tile"
      />,
    )
    expect(screen.getByText('Argentinian')).toBeInTheDocument()
    expect(screen.queryByText('EU')).not.toBeInTheDocument()
  })

  it('shows EU pill when single nationality is EU', () => {
    render(
      <DualNationalityDisplay
        primaryCountryId={10}
        secondaryCountryId={null}
        mode="tile"
      />,
    )
    expect(screen.getByText('Dutch')).toBeInTheDocument()
    expect(screen.getByText('EU')).toBeInTheDocument()
  })

  it('renders BOTH names for dual nationality', () => {
    render(
      <DualNationalityDisplay
        primaryCountryId={20}
        secondaryCountryId={10}
        mode="tile"
      />,
    )
    expect(screen.getByText('Argentinian')).toBeInTheDocument()
    expect(screen.getByText('Dutch')).toBeInTheDocument()
  })

  it('shows EU pill when ANY nationality is EU (primary EU, secondary not)', () => {
    render(
      <DualNationalityDisplay
        primaryCountryId={10} // EU
        secondaryCountryId={20} // non-EU
        mode="tile"
      />,
    )
    expect(screen.getByText('EU')).toBeInTheDocument()
  })

  it('shows EU pill when secondary nationality is EU and primary is not', () => {
    render(
      <DualNationalityDisplay
        primaryCountryId={20} // non-EU
        secondaryCountryId={10} // EU
        mode="tile"
      />,
    )
    expect(screen.getByText('EU')).toBeInTheDocument()
  })

  it('hides EU pill when neither nationality is EU', () => {
    render(
      <DualNationalityDisplay
        primaryCountryId={20}
        secondaryCountryId={null}
        mode="tile"
      />,
    )
    expect(screen.queryByText('EU')).not.toBeInTheDocument()
  })

  it('uses flex-wrap container so long second nationality wraps cleanly', () => {
    const { container } = render(
      <DualNationalityDisplay
        primaryCountryId={20}
        secondaryCountryId={10}
        mode="tile"
      />,
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('flex-wrap')
    expect(wrapper.className).toContain('items-center')
  })

  it('shows loading placeholder while countries hook is loading', () => {
    // override hook for this test
    vi.doMock('@/hooks/useCountries', () => ({
      useCountries: () => ({
        countries: [],
        loading: true,
        error: null,
        getCountryById: () => undefined,
        getCountryByCode: () => undefined,
        isEuCountry: () => false,
      }),
    }))
  })
})

describe('DualNationalityDisplay — full mode (regression guard)', () => {
  it('shows EU label as a pill (full mode keeps prior behavior)', () => {
    render(
      <DualNationalityDisplay
        primaryCountryId={10}
        secondaryCountryId={null}
        mode="full"
      />,
    )
    expect(screen.getByText('Dutch')).toBeInTheDocument()
    expect(screen.getByText('EU')).toBeInTheDocument()
  })

  it('full mode renders both nationalities on separate lines', () => {
    render(
      <DualNationalityDisplay
        primaryCountryId={20}
        secondaryCountryId={10}
        mode="full"
      />,
    )
    expect(screen.getByText('Argentinian')).toBeInTheDocument()
    expect(screen.getByText('Dutch')).toBeInTheDocument()
  })
})
