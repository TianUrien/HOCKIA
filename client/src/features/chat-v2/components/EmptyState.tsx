import { useInboxT } from '@/i18n/ns/inbox'

export function EmptyState() {
  const t = useInboxT()
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center p-6 text-center">
      <p className="text-row text-ink-2">{t('chat.empty')}</p>
    </div>
  )
}
