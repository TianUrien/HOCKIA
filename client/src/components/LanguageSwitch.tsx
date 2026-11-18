import { useState } from 'react'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { currentLanguage } from '@/i18n'
import { useCommonT } from '@/i18n/ns/common'
import { chooseLanguage } from '@/i18n/saveLanguage'
import type { UiLanguage } from '@/i18n/languages'
import { cn } from '@/lib/utils'

/**
 * English / Español. Switches the interface at once, remembers the choice
 * on this device and saves it on the profile when signed in. Language names
 * are shown in their own language on purpose, so the switch can be found
 * without reading the current one. (The "beta" label and note were removed
 * on 2026-11-17, founder decision, once the app was translated.)
 */
export function LanguageSwitch({ className, variant = 'segmented' }: { className?: string; variant?: 'segmented' | 'pill' }) {
  const t = useCommonT()
  const [value, setValue] = useState<UiLanguage>(currentLanguage())

  const onChange = (next: UiLanguage) => {
    setValue(next)
    void chooseLanguage(next)
  }

  // One small button naming the OTHER language, for screens with no room
  // for the two-option control (the native welcome screen).
  if (variant === 'pill') {
    const other: UiLanguage = value === 'en' ? 'es' : 'en'
    return (
      <button
        type="button"
        lang={other}
        onClick={() => onChange(other)}
        data-testid="language-switch"
        className={cn('min-h-[36px] rounded-full bg-white/80 px-3.5 text-secondary font-medium text-ink-1 shadow-sm backdrop-blur', className)}
      >
        {t(other === 'es' ? 'language.spanish' : 'language.english')}
      </button>
    )
  }

  return (
    <div className={className} data-testid="language-switch">
      <SegmentedControl<UiLanguage>
        ariaLabel={t('language.label')}
        value={value}
        onChange={onChange}
        options={[
          { value: 'en', label: t('language.english') },
          { value: 'es', label: t('language.spanish') },
        ]}
      />
    </div>
  )
}
