interface NewMessagesToastProps {
  visible: boolean
  label: string
  onClick: () => void
}

export function NewMessagesToast({ visible, label, onClick }: NewMessagesToastProps) {
  if (!visible) return null

  return (
    <div className="sticky bottom-[calc(1rem+var(--chat-safe-area-bottom,0px))] z-10 flex justify-center pb-2">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex w-full max-w-xs flex-col items-center gap-1 rounded-2xl bg-white/95 px-4 py-2 text-sm text-ink-1 shadow-lg ring-1 ring-line backdrop-blur transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary hover:shadow-xl sm:max-w-sm"
      >
        <span className="font-semibold">⬇ {label}</span>
      </button>
    </div>
  )
}
