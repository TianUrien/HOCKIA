import { SOCIAL_PLATFORMS, type SocialLinks, type SocialPlatform } from '@/lib/socialLinks'
import { useProfileEditT } from '@/i18n/ns/profileEdit'

interface SocialLinksInputProps {
  value: SocialLinks
  onChange: (links: SocialLinks) => void
  error?: string
}

export default function SocialLinksInput({ value, onChange, error }: SocialLinksInputProps) {
  const t = useProfileEditT()
  const handleChange = (platform: SocialPlatform, url: string) => {
    const trimmedUrl = url.trim()
    const newLinks = { ...value }
    
    if (trimmedUrl) {
      newLinks[platform] = trimmedUrl
    } else {
      delete newLinks[platform]
    }
    
    onChange(newLinks)
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        {t('social.title')}
      </label>
      <p className="text-xs text-gray-500 mb-3">
        {t('social.hint')}
      </p>
      
      <div className="space-y-3">
        {SOCIAL_PLATFORMS.map(({ key, label, icon: Icon, placeholder, color }) => (
          <div key={key} className="flex items-center gap-3">
            <div className={`flex-shrink-0 w-8 h-8 flex items-center justify-center ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <input
                type="url"
                value={value[key] || ''}
                onChange={(e) => handleChange(key, e.target.value)}
                placeholder={placeholder}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                aria-label={t('social.inputLabel', { platform: label })}
              />
            </div>
          </div>
        ))}
      </div>
      
      {error && (
        <p className="text-sm text-red-600 mt-2">{error}</p>
      )}
    </div>
  )
}
