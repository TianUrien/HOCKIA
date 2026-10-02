import { Link } from 'react-router-dom'
import { useOwnApplicationStatus } from '@/hooks/useSigning'

/**
 * Under the server's "<club> marked you as signed…" step line (D4.4 → D4.5):
 * while the signing still waits for the player, a link to Confirm signing.
 * Nothing once it is confirmed, undone or expired. Player only.
 */
export default function SigningPrompt({ applicationId }: { applicationId: string }) {
  const status = useOwnApplicationStatus(applicationId, true)
  if (status !== 'signed_pending_confirmation') return null
  return (
    <div className="flex justify-center pt-1.5">
      <Link
        to={`/applications/${applicationId}/signing`}
        className="rounded-full bg-hockia-primary px-4 py-2 text-secondary font-semibold text-white"
        data-testid="signing-prompt"
      >
        Confirm signing
      </Link>
    </div>
  )
}
