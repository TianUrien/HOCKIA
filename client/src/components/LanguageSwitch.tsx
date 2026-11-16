import { useState } from 'react'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { currentLanguage } from '@/i18n'
import { useCommonT } from '@/i18n/ns/common'
import { chooseLanguage } from '@/i18n/saveLanguage'
import type { UiLanguage } from '@/i18n/languages'
import { cn } from '@/lib/utils'

/**
 * English / Español (beta). Switches the interface at once, remembers the
 * choice on this device and saves it on the profile when signed in. The note
 * under it says Spanish is not complete yet (opt-in beta, founder decision
 * 2026-11-15). Language names are shown in their own language on purpose, so
 * the switch can be found without reading the current one.
 */
export function LanguageSwitch({ className, showNote = true }: { className?: string; showNote?: boolean }) {
  const t = useCommonT()
  const [value, setValue] = useState<UiLanguage>(currentLanguage())

  const onChange = (next: UiLanguage) => {
    setValue(next)
    void chooseLanguage(next)
  }

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="language-switch">
      <SegmentedControl<UiLanguage>
        ariaLabel={t('language.label')}
        value={value}
        onChange={onChange}
        options={[
          { value: 'en', label: t('language.english') },
          { value: 'es', label: t('language.spanish') },
        ]}
      />
      {showNote && value === 'es' && <p className="text-caption leading-[16px] text-ink-3">{t('language.betaNote')}</p>}
    </div>
  )
}
