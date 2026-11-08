/**
 * Players apply to player opportunities and coaches to coach opportunities
 * (the opportunity_applications insert policy enforces it). Returns why the
 * viewer can't apply, or null when they can or we can't tell. Used before
 * offering "Prepare my application" so a mismatch never reaches the server
 * as an RLS error (Sentry JAVASCRIPT-REACT-EC, 2026-11-06).
 */
export function applyRoleMismatch(opportunityType: string | null | undefined, viewerRole: string | null | undefined): string | null {
  if (!opportunityType || !viewerRole) return null
  if (viewerRole !== 'player' && viewerRole !== 'coach') return null
  if (opportunityType === viewerRole) return null
  if (opportunityType === 'player') return 'This opportunity is for players.'
  if (opportunityType === 'coach') return 'This opportunity is for coaches.'
  return null
}
