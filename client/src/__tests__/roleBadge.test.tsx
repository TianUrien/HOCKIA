import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import RoleBadge from '@/components/RoleBadge'

/**
 * RoleBadge on the Figma `role/*` tokens (design review 2026-10-03). The
 * badge used to carry raw hex; it now uses `bg-role-<role>-bg` /
 * `text-role-<role>-ink`. These tests pin that the colours Tailwind
 * resolves for those classes are byte-for-byte the hex the badge rendered
 * before, so a token re-export can never recolour a badge unnoticed.
 */
const CLIENT = resolve(__dirname, '../..')

/** The hex pairs the badge rendered before the token move (bg, ink). */
const PREVIOUS: Record<string, [string, string]> = {
  player: ['#eff6ff', '#2563eb'],
  coach: ['#f0fdfa', '#0f766e'],
  club: ['#fff7ed', '#c2410c'],
  brand: ['#fff1f2', '#be123c'],
}

function tokenRoles(): Record<string, string> {
  const src = readFileSync(resolve(CLIENT, 'src/styles/tokens/tokens.js'), 'utf8')
  const start = src.indexOf('export const colors = ') + 'export const colors = '.length
  const end = src.indexOf('\n}\n', start) + 2
  const colors = JSON.parse(src.slice(start, end)) as Record<string, Record<string, string>>
  return colors.role
}

async function resolvedCss(classes: string[]): Promise<string> {
  const config = (await import(/* @vite-ignore */ resolve(CLIENT, 'tailwind.config.js'))).default as Record<string, unknown>
  const result = await postcss([
    tailwindcss({ ...config, content: [{ raw: `<span class="${classes.join(' ')}"></span>` }] }),
  ]).process('@tailwind utilities;', { from: undefined })
  return result.css
}

function declared(css: string, cls: string, prop: 'background-color' | 'color'): string | null {
  const escaped = cls.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
  // The last declaration of a rule carries no trailing semicolon.
  const m = css.match(new RegExp(`\\.${escaped}\\s*\\{[^}]*?(?<![-\\w])${prop}:\\s*([^;}]+)`))
  return m ? m[1].trim() : null
}

/** Tailwind emits `rgb(r g b / var(--tw-bg-opacity))`; normalise to #rrggbb. */
function toHex(value: string): string {
  const m = value.match(/rgb\((\d+)\s+(\d+)\s+(\d+)/)
  if (!m) return value.toLowerCase()
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
}

describe('RoleBadge colours on the role/* tokens', () => {
  it('the tokens carry exactly the hex the badge rendered before', () => {
    const role = tokenRoles()
    for (const [name, [bg, ink]] of Object.entries(PREVIOUS)) {
      expect(role[`${name}-bg`].toLowerCase()).toBe(bg)
      expect(role[`${name}-ink`].toLowerCase()).toBe(ink)
    }
  })

  it('Tailwind resolves bg-role-*-bg / text-role-*-ink to those same values', async () => {
    const classes = Object.keys(PREVIOUS).flatMap((r) => [`bg-role-${r}-bg`, `text-role-${r}-ink`])
    const css = await resolvedCss(classes)
    for (const [name, [bg, ink]] of Object.entries(PREVIOUS)) {
      const bgValue = declared(css, `bg-role-${name}-bg`, 'background-color')
      const inkValue = declared(css, `text-role-${name}-ink`, 'color')
      expect(bgValue, `bg-role-${name}-bg must be generated`).not.toBeNull()
      expect(inkValue, `text-role-${name}-ink must be generated`).not.toBeNull()
      expect(toHex(bgValue as string)).toBe(bg)
      expect(toHex(inkValue as string)).toBe(ink)
    }
  }, 20000)

  it('renders the token classes per role, umpire stays neutral, no raw hex left', () => {
    render(
      <>
        <RoleBadge role="player" />
        <RoleBadge role="coach" />
        <RoleBadge role="club" />
        <RoleBadge role="brand" />
        <RoleBadge role="umpire" />
      </>,
    )
    expect(screen.getByText('Player').className).toMatch(/\bbg-role-player-bg\b.*\btext-role-player-ink\b/)
    expect(screen.getByText('Coach').className).toMatch(/\bbg-role-coach-bg\b.*\btext-role-coach-ink\b/)
    expect(screen.getByText('Club').className).toMatch(/\bbg-role-club-bg\b.*\btext-role-club-ink\b/)
    expect(screen.getByText('Brand').className).toMatch(/\bbg-role-brand-bg\b.*\btext-role-brand-ink\b/)
    expect(screen.getByText('Umpire').className).toMatch(/\bbg-surface-muted\b.*\btext-ink-2\b/)
    for (const label of ['Player', 'Coach', 'Club', 'Brand', 'Umpire']) {
      expect(screen.getByText(label).className).not.toMatch(/#[0-9a-f]{3,6}/i)
      expect(screen.getByText(label).className).not.toMatch(/amber|yellow/i)
    }
    const source = readFileSync(resolve(CLIENT, 'src/components/RoleBadge.tsx'), 'utf8')
    expect(source).not.toMatch(/\[#[0-9a-f]{3,6}\]/i)
  })
})
