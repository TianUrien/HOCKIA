import { ShieldCheck, Users, Sparkles, Plus } from 'lucide-react'
import Button from '../Button'

/**
 * Top summary card on the player Community hub. Surfaces the three
 * trust/network metrics + the two primary CTAs so a player lands on
 * /community and immediately knows:
 *   - How many of their 5 reference slots are filled
 *   - How big their connection network is
 *   - Whether anything's waiting on them (pending count)
 *
 * Green CTA (Add Reference) leads the eye — references are the
 * credibility layer, the more constrained slot (max 5), and the
 * higher-impact action. Manage Friends is the secondary path.
 */
interface CredibilityNetworkCardProps {
  /** Accepted reference count (filled slots, max 5). */
  referencesUsed: number
  /** Max reference slots (currently 5; passed through so the constant
   *  lives in one place — `useTrustedReferences` exports MAX_REFERENCES). */
  referencesMax: number
  /** Accepted (active) connections count. */
  connectionsCount: number
  /** Pending = incoming reference requests + incoming friend requests.
   *  This is "things waiting on you" — the unified attention number. */
  pendingCount: number
  onAddReference: () => void
  onManageFriends: () => void
  /** Disable the Add Reference CTA when at cap. The hook gates the
   *  underlying RPC too — this is just visual feedback. */
  addReferenceDisabled?: boolean
}

export default function CredibilityNetworkCard({
  referencesUsed,
  referencesMax,
  connectionsCount,
  pendingCount,
  onAddReference,
  onManageFriends,
  addReferenceDisabled = false,
}: CredibilityNetworkCardProps) {
  return (
    <section
      data-testid="credibility-network-card"
      className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 md:p-6"
    >
      <header className="flex items-center gap-2.5 mb-4">
        <ShieldCheck className="h-5 w-5 text-emerald-500" aria-hidden="true" />
        <h2 className="text-base font-semibold text-gray-900">Your credibility network</h2>
      </header>

      {/* 3-up metric grid */}
      <div className="grid grid-cols-3 gap-2.5 mb-5">
        <Stat
          icon={Users}
          label="References"
          value={`${referencesUsed} / ${referencesMax}`}
          accent="emerald"
        />
        <Stat
          icon={Users}
          label="Connections"
          value={connectionsCount.toString()}
          accent="gray"
        />
        <Stat
          icon={Sparkles}
          label="Pending"
          value={pendingCount.toString()}
          accent="purple"
        />
      </div>

      {/* CTAs — green primary, white secondary. Green carries the "trust /
          positive" weight per the brand's existing trust-action language
          (already used in TrustedReferencesSection headers). */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={onAddReference}
          disabled={addReferenceDisabled}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 text-white px-4 py-3 text-sm font-semibold shadow-sm hover:bg-emerald-600 transition-colors disabled:opacity-60 disabled:hover:bg-emerald-500"
        >
          <Plus className="h-4 w-4" />
          Add Reference
        </button>
        <Button
          variant="outline"
          onClick={onManageFriends}
          className="!h-auto !rounded-xl py-3 text-sm font-semibold"
        >
          Manage Friends
        </Button>
      </div>
    </section>
  )
}

interface StatProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  accent: 'emerald' | 'gray' | 'purple'
}

const ACCENT_CLASSES: Record<StatProps['accent'], { iconBg: string; iconColor: string }> = {
  emerald: { iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  gray: { iconBg: 'bg-gray-100', iconColor: 'text-gray-500' },
  purple: { iconBg: 'bg-hockia-primary/10', iconColor: 'text-hockia-primary' },
}

function Stat({ icon: Icon, label, value, accent }: StatProps) {
  const { iconBg, iconColor } = ACCENT_CLASSES[accent]
  return (
    <div className="rounded-xl bg-gray-50/80 border border-gray-100 p-3">
      <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${iconBg} mb-2`}>
        <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
      </div>
      <p className="text-base font-bold text-gray-900 tabular-nums leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-medium text-gray-500 leading-none">{label}</p>
    </div>
  )
}
