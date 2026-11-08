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

/**
 * Player · Brand partnerships (Figma 08 · Brands AC2 / AC3, built 2026-11-07).
 * Off by default. On: brands that sell where the player lives can find them
 * and invite them as an ambassador; they see what the profile already shows
 * plus the Instagram handle and the follower count the player declares.
 */
export default function BrandPartnershipsPage() {
  const navigate = useNavigate()
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
    if (handle && !HANDLE_RE.test(handle)) { setError('Use your Instagram username: letters, numbers, dots and underscores.'); return }
    const n = followers.trim() ? Number(followers.replace(/[^\d]/g, '')) : null
    if (n != null && (!Number.isFinite(n) || n > 100_000_000)) { setError('Enter your follower count as a number.'); return }
    setError(null)
    setSaving(true)
    try {
      const saved = await saveMyPartnership({ ...f, instagram_handle: handle || null, instagram_followers: n })
      qc.setQueryData(['my-brand-partnership'], saved)
      addToast(saved.open ? 'Brands where you live can now find you.' : 'Brands no longer see you.', 'success')
      navigate(-1)
    } catch (err) {
      logger.error('[BrandPartnerships] save failed', err)
      setError('That didn’t save. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-subtle" data-testid="brand-partnerships">
      <Header mobileHidden />
      <DetailNavBar parent="Settings" title="Brand partnerships" fallbackPath="/settings" />
      <main className="mx-auto max-w-[640px] pb-28 pt-2 lg:pt-under-header-lg">
        {!f ? <div className="mx-4 mt-4 h-32 animate-pulse rounded-[20px] bg-white" /> : (
          <>
            <SettingsGroup footer="Off by default. Members under 18 never appear to brands.">
              <SettingsRow title="Open to brand partnerships" trailing={<SettingsSwitch label="Open to brand partnerships" checked={f.open} onChange={() => setF({ ...f, open: !f.open })} />} />
              <SettingsRow title="Open to other brands" subtitle="While you are an ambassador, other brands can still find you." trailing={<SettingsSwitch label="Open to other brands" checked={f.open_to_other_brands} disabled={!f.open} onChange={() => setF({ ...f, open_to_other_brands: !f.open_to_other_brands })} />} />
            </SettingsGroup>

            <section className="mx-4 mt-6 rounded-[20px] bg-white p-4">
              <h2 className="text-body font-semibold text-ink-1">What this means</h2>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-row text-ink-2">
                <li>Brands that sell in your country can find you and invite you as an ambassador.</li>
                <li>They see what your profile already shows: photo, name, position, club and where you live, plus your Instagram below. Never your contact details.</li>
                <li>You decide: accept, decline or ignore any invitation.</li>
                <li>Turn it off any time. You stop appearing to brands right away.</li>
              </ul>
            </section>

            <section className="mx-4 mt-6 space-y-4 rounded-[20px] bg-white p-4" aria-label="Instagram">
              <div>
                <label htmlFor="bp-handle" className={fieldLabel}>Instagram</label>
                <input id="bp-handle" value={f.instagram_handle ?? ''} onChange={(e) => setF({ ...f, instagram_handle: e.target.value })} placeholder="@yourname" autoCapitalize="none" autoCorrect="off" spellCheck={false} className={fieldInput} data-testid="bp-handle" />
              </div>
              <div>
                <label htmlFor="bp-followers" className={fieldLabel}>Followers</label>
                <input id="bp-followers" inputMode="numeric" value={followers} onChange={(e) => setFollowers(e.target.value)} placeholder="1200" className={fieldInput} data-testid="bp-followers" />
                <p className="mt-1.5 text-caption text-ink-3">You declare this. Brands see it marked as declared; Hockia doesn’t check it.</p>
              </div>
            </section>
            {error ? <p className="mx-4 mt-3 text-row text-status-danger" role="alert">{error}</p> : null}
            <div className="mx-4 mt-6">
              <Button block loading={saving} onClick={() => void save()} data-testid="bp-save">Save</Button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
