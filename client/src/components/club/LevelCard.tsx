import { Flag, Trophy } from 'lucide-react'
import type { PlayerLevel } from '@/lib/playerLevel'
import { levelRows } from '@/lib/playerLevel'
import { cn } from '@/lib/utils'
import { useRecruitingT } from '@/i18n/ns/recruiting'

/**
 * "Level played" (founder ruling 2026-11-23): the highest league and division
 * and the national team, as facts, at the top of what a recruiter reads about
 * a player. CLUB surfaces only: never mount on a player-facing screen. It
 * shows no band, score or adjective, and says so when the profile has
 * nothing to go on.
 */
export function LevelCard({ level, loading = false, className }: { level: PlayerLevel | null; loading?: boolean; className?: string }) {
  const t = useRecruitingT()
  if (loading && !level) return null
  const rows = level ? levelRows(level) : []
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl bg-surface-grouped p-4', className)} data-testid="level-card">
      <span className="text-row font-semibold text-ink-1">{t('levelCard.title')}</span>
      {rows.length === 0 && <p className="text-secondary text-ink-2" data-testid="level-card-empty">{t('levelCard.empty')}</p>}
      {rows.map((r) => {
        const Icon = r.key === 'national' ? Flag : Trophy
        return (
          <div key={r.key} className="flex items-start gap-2.5" data-testid={`level-row-${r.key}`}>
            <span className="mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-white text-ink-2">
              <Icon className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-caption font-semibold uppercase tracking-[0.02em] text-ink-3">{r.label}</span>
              <span className="block break-words text-[16px] font-semibold leading-[21px] text-ink-1">{r.value}</span>
              {r.detail && <span className="block break-words text-secondary text-ink-2">{r.detail}</span>}
            </span>
          </div>
        )
      })}
      <p className="text-caption text-ink-3">{t('levelCard.footer')}</p>
    </div>
  )
}
