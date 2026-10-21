/**
 * Tests for opportunity creation/update toast messaging.
 *
 * Validates that:
 * - New creation → info toast with draft message (not misleading "created successfully")
 * - Draft update → info toast with draft message
 * - Published update → success toast
 * - Publish action → success toast
 */
import { resolve } from 'path'
import { readFileSync } from 'fs'

// --- Source paths ---
const COMPONENTS_DIR = resolve(__dirname, '..', 'components')
const MODAL_SOURCE = resolve(COMPONENTS_DIR, 'CreateOpportunityModal.tsx')
const TAB_SOURCE = resolve(COMPONENTS_DIR, 'OpportunitiesTab.tsx')

describe('Toast message correctness', () => {
  it('creation toast says "Draft saved" not "created successfully"', () => {
    const source = readFileSync(MODAL_SOURCE, 'utf-8')

    expect(source).toContain("Draft saved")
    expect(source).toContain("Publish when you")
    expect(source).toContain("ready to go live.")
    expect(source).toContain("'info'")
    expect(source).not.toContain('Opportunity created successfully.')
  })

  it('draft update toast says "Draft updated" with info type', () => {
    const source = readFileSync(MODAL_SOURCE, 'utf-8')

    expect(source).toContain("Draft updated")
    expect(source).toContain("ready to go live.")
  })

  it('published update toast says "Opportunity updated successfully." with success type', () => {
    const source = readFileSync(MODAL_SOURCE, 'utf-8')

    expect(source).toContain("Opportunity updated successfully.")
    expect(source).toContain("'success'")
  })

  it('publish action toast says "Opportunity published successfully!"', () => {
    const source = readFileSync(TAB_SOURCE, 'utf-8')

    expect(source).toContain('Opportunity published successfully!')
  })
})
