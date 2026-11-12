import { test, expect } from './fixtures'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

type SeededVacancyData = {
  id: string | null
  title: string
  clubId: string
}

function readSeededVacancy(): SeededVacancyData {
  const filePath = path.join(__dirname, '.data', 'vacancy.json')
  const raw = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as SeededVacancyData
}

test.describe('Vacancy Management - Club', () => {
  test('club can open applicants page for seeded vacancy', async ({ page }) => {
    const seeded = readSeededVacancy()

    expect(seeded.id, 'Seeded vacancy id should be written by auth.setup').toBeTruthy()

    await page.goto(`/dashboard/opportunities/${seeded.id}/applicants`)

    // Applicants screen (club redesign): the role header names the role, the
    // actions button carries the full opportunity title.
    const header = page.getByTestId('applicants-role-header')
    await expect(header.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: `More actions for ${seeded.title}` })).toBeVisible()

    const statuses = page.getByRole('tablist', { name: 'Application status' })
    await expect(statuses.getByRole('tab', { name: /^To review/ })).toHaveAttribute('aria-selected', 'true')
    for (const name of [/^Shortlisted/, /^Maybe/, /^Not a fit/, /^Closed/]) {
      await expect(statuses.getByRole('tab', { name })).toBeVisible()
    }

    // Either nobody is waiting, or applicant rows exist (depending on whether
    // the player spec has applied and where the club left that application).
    const emptyState = page.getByText('Nobody waiting. New applicants show up here.')
    await expect(emptyState.or(page.getByTestId('applicant-row').first())).toBeVisible({ timeout: 20000 })
  })
})
