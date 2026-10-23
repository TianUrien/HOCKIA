import { test, expect } from './fixtures'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'

/**
 * Accessibility guard (2026-10-23): axe scans the main screens for serious
 * and critical WCAG 2.1 A/AA problems. Problems already known on a screen are
 * listed in a11y-baseline.json (to be fixed and removed there); any NEW kind
 * of problem fails. Automated checks find only part of the issues; screen
 * reader and keyboard passes are still manual.
 */
const SCREENS = ['/home', '/community', '/opportunities', '/messages', '/dashboard/profile', '/search']
const known = (JSON.parse(readFileSync(new URL('./a11y-baseline.json', import.meta.url), 'utf8')) as { projects: Record<string, Record<string, string[]>> }).projects

test.describe('@smoke accessibility', () => {
  for (const screen of SCREENS) {
    test(`no new serious accessibility problems on ${screen}`, async ({ page }, info) => {
      await page.goto(screen)
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
      await page.waitForTimeout(1000)
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      const allowed = new Set(known[info.project.name]?.[screen] ?? [])
      const fresh = result.violations
        .filter((v) => (v.impact === 'serious' || v.impact === 'critical') && !allowed.has(v.id))
        .map((v) => `${v.id} (${v.impact}, ${v.nodes.length}×): ${v.help} — e.g. ${v.nodes[0]?.target?.join(' ')}`)
      expect(fresh, `New accessibility problems on ${screen}`).toEqual([])
    })
  }
})
