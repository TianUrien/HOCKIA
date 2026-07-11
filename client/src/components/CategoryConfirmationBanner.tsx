import { Info } from 'lucide-react'
import Button from './Button'

interface CategoryConfirmationBannerProps {
  /** True when the user's profile has the category_confirmation_needed flag.
   * Banner is hidden when false (returns null). */
  needsConfirmation: boolean
  /** Called when the user clicks the CTA — typically opens the edit-profile
   * modal scrolled to the category section. */
  onConfirm: () => void
}

/**
 * Shown on a user's own dashboard when Phase 3 migrated their profile from
 * the legacy `gender` column to the new hockey-category fields with a
 * best-effort default. Asks the user to confirm or correct the guess.
 *
 * Cleared by setting profile.category_confirmation_needed = false on save —
 * which the EditProfileModal already does for player / coach / umpire branches.
 *
 * Hidden entirely when the flag is false (returns null) so it doesn't clutter
 * the dashboard for users who never had the legacy gender mapping applied.
 */
export default function CategoryConfirmationBanner({
  needsConfirmation,
  onConfirm,
}: CategoryConfirmationBannerProps) {
  if (!needsConfirmation) return null

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex items-start gap-3">
        <Info className="w-5 h-5 text-hockia-primary flex-shrink-0 mt-0.5" />
        <p className="text-sm text-gray-800">
          We&apos;ve updated HOCKIA to use hockey categories instead of gender.
          Please confirm or update your category preferences.
        </p>
      </div>
      <Button
        variant="primary"
        onClick={onConfirm}
        className="whitespace-nowrap flex-shrink-0"
      >
        Update categories
      </Button>
    </div>
  )
}
