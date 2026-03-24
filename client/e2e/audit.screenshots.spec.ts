import { test, expect } from '@playwright/test'

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 }, // iPhone 14-ish
  tablet: { width: 820, height: 1180 }, // iPad Air-ish
} as const

test.describe('HOCKIA audit screenshots (public)', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`${name}: landing + signup + opportunities`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)

      await page.goto('/')
      await expect(page.getByRole('main')).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath(`${name}-landing.png`),
        fullPage: true,
      })

      // Signup
      await page.goto('/signup')
      await expect(page.getByRole('heading', { name: /join hockia/i })).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath(`${name}-signup-role-selection.png`),
        fullPage: true,
      })

      // Opportunities
      await page.goto('/opportunities')
      await page.waitForLoadState('networkidle')
      await page.screenshot({
        path: testInfo.outputPath(`${name}-opportunities.png`),
        fullPage: true,
      })
    })

    test(`${name}: privacy + terms`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)

      await page.goto('/privacy-policy')
      await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath(`${name}-privacy.png`),
        fullPage: true,
      })

      await page.goto('/terms')
      await expect(page.getByRole('heading', { level: 1, name: 'Terms & Conditions' })).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath(`${name}-terms.png`),
        fullPage: true,
      })
    })
  }
})
