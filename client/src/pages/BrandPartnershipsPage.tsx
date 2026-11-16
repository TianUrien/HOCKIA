import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Header from '@/components/Header'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { Button } from '@/components/ui/Button'
import { SettingsGroup, SettingsRow, SettingsSwitch } from '@/components/settings/settingsUi'
import { fieldInput, fieldLabel } from '@/components/ui/fieldClasses'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { HANDLE_RE, fetchMyPartnership, handleFromSocial, saveMyPartnership, type MyPartnership } from '@/lib/brandPartnerships'
import { useBrandsT } from '@/i18n/ns/brands'

/**
 * Player · Brand partnerships (Figma 08 · Brands AC2 / AC3, built 2026-11-07).
 * Off by default. On: brands that sell where the player lives can find them
 * and invite them as an ambassador; they see what the profile already shows
 * plus the Instagram handle and the follower count the player declares.
 */
export default function BrandPartnershipsPage() {
  const navigate = useNavigate()
  const t = useBrandsT()
  const profile = useAuthStore((s) => s.profile)
  const addToast = useToastStore((s) => s.addToast)
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['my-brand-partnership'], queryFn: fetchMyPartnership, enabled: profile?.role === 'player' })
  const [f, setF] = useState<MyPartnership | null>(null)
  const [followers, setFollowers] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!q.data || f) return
    setF({ ...q.data, instagram_handle: q.data.instagram_handle ?? handleFromSocial(profile?.social_links) })
    setFollowers(q.data.instagram_followers != null ? String(q.data.instagram_followers) : '')
  }, [q.data, f, profile?.social_links])

  if (profile && profile.role !== 'player') return <Navigate to="/settings" replace />

  const save = async () => {
    if (!f) return
    const handle = (f.instagram_handle ?? '').trim()
    if (handle && !HANDLE_RE.test(handle)) { setError(t('partnerships.errors.handle')); return }
    const n = followers.trim() ? Number(followers.replace(/[^\d]/g, '')) : null
    if (n != null && (!Number.isFinite(n) || n > 100_000_000)) { setError(t('partnerships.errors.followers')); return }
    setError(null)
    setSaving(true)
    try {
      const saved = await saveMyPartnership({ ...f, instagram_handle: handle || null, instagram_followers: n })
      qc.setQueryData(['my-brand-partnership'], saved)
      addToast(saved.open ? t('partnerships.toasts.on') : t('partnerships.toasts.off'), 'success')
      navigate(-1)
    } catch (err) {
      logger.error('[BrandPartnerships] save failed', err)
      setError(t('partnerships.errors.save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-subtle" data-testid="brand-partnerships">
      <Header mobileHidden />
      <DetailNavBar parent={t('partnerships.navParent')} title={t('partnerships.title')} fallbackPath="/settings" />
      <main className="mx-auto max-w-[640px] pb-28 pt-2 lg:pt-under-header-lg">
        {!f ? <div className="mx-4 mt-4 h-32 animate-pulse rounded-[20px] bg-white" /> : (
          <>
            <SettingsGroup footer={t('partnerships.footer')}>
              <SettingsRow title={t('partnerships.open')} trailing={<SettingsSwitch label={t('partnerships.open')} checked={f.open} onChange={() => setF({ ...f, open: !f.open })} />} />
              <SettingsRow title={t('partnerships.openOther')} subtitle={t('partnerships.openOtherHint')} trailing={<SettingsSwitch label={t('partnerships.openOther')} checked={f.open_to_other_brands} disabled={!f.open} onChange={() => setF({ ...f, open_to_other_brands: !f.open_to_other_brands })} />} />
            </SettingsGroup>

            <section className="mx-4 mt-6 rounded-[20px] bg-white p-4">
              <h2 className="text-body font-semibold text-ink-1">{t('partnerships.meaning.title')}</h2>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-row text-ink-2">
                <li>{t('partnerships.meaning.find')}</li>
                <li>{t('partnerships.meaning.see')}</li>
                <li>{t('partnerships.meaning.decide')}</li>
                <li>{t('partnerships.meaning.off')}</li>
              </ul>
            </section>

            <section className="mx-4 mt-6 space-y-4 rounded-[20px] bg-white p-4" aria-label="Instagram">
              <div>
                <label htmlFor="bp-handle" className={fieldLabel}>Instagram</label>
                <input id="bp-handle" value={f.instagram_handle ?? ''} onChange={(e) => setF({ ...f, instagram_handle: e.target.value })} placeholder={t('partnerships.handlePlaceholder')} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={fieldInput} data-testid="bp-handle" />
              </div>
              <div>
                <label htmlFor="bp-followers" className={fieldLabel}>{t('partnerships.followersLabel')}</label>
                <input id="bp-followers" inputMode="numeric" value={followers} onChange={(e) => setFollowers(e.target.value)} placeholder="1200" className={fieldInput} data-testid="bp-followers" />
                <p className="mt-1.5 text-caption text-ink-3">{t('partnerships.followersHint')}</p>
              </div>
            </section>
            {error ? <p className="mx-4 mt-3 text-row text-status-danger" role="alert">{error}</p> : null}
            <div className="mx-4 mt-6">
              <Button block loading={saving} onClick={() => void save()} data-testid="bp-save">{t('partnerships.save')}</Button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
