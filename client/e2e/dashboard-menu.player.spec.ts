import { test, expect } from './fixtures'

/**
 * Settings and Sign out must be reachable from the profile, inside the
 * viewport. The hamburger ("Open menu") this spec used to open is gone:
 * desktop has the avatar menu in the top bar; the phone layout has the
 * Settings gear on the profile hero, which opens the Settings screen.
 */
test.describe('Account menu', () => {
  test('desktop: avatar menu shows Settings and Sign out inside the viewport', async ({ page, isMobile }) => {
    test.skip(isMobile, 'phone layout has no avatar menu: covered below')
    const viewport = page.viewportSize()!

    await page.goto('/dashboard/profile')
    await expect(page.getByTestId('profile-hero-name')).toBeVisible({ timeout: 20000 })

    await page.getByRole('button', { name: 'Open account menu' }).click()

    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()

    const box = await menu.boundingBox()
    expect(box, 'Menu should have a bounding box').not.toBeNull()
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    }

    await menu.getByRole('menuitem', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/settings/)
  })

  test('phone: the profile gear opens Settings, which offers Sign out', async ({ page }) => {
    const viewport = { width: 390, height: 844 }
    await page.setViewportSize(viewport)

    await page.goto('/dashboard/profile')
    await expect(page.getByTestId('profile-hero-name')).toBeVisible({ timeout: 20000 })

    const gear = page.getByTestId('profile-hero').getByRole('button', { name: 'Settings' })
    await expect(gear).toBeVisible()
    const box = await gear.boundingBox()
    expect(box, 'Settings gear should have a bounding box').not.toBeNull()
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    }

    await gear.click()
    await expect(page).toHaveURL(/\/settings/)
    // Never clicked: signing out would invalidate the shared storage state.
    const signOut = page.getByRole('button', { name: 'Sign out' })
    await signOut.scrollIntoViewIfNeeded()
    await expect(signOut).toBeVisible()
  })
})
