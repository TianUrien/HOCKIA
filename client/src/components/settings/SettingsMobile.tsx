import { lazy, Suspense, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, FileText, HelpCircle, Languages, Lock, MessageSquare, Shield } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import BlockedAccountsList from '@/components/BlockedAccountsList'
import DeleteAccountModal from '@/components/DeleteAccountModal'
import { SettingsGroup, SettingsRow, SettingsSwitch } from './settingsUi'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { usePushSubscription } from '@/hooks/usePushSubscription'
import { useBlockedUsers } from '@/hooks/useBlockedUsers'
import { roleLabel } from '@/lib/identity'
import { getImageUrl } from '@/lib/imageUrl'
import { isRecruitableRole } from '@/lib/settingsRoles'
import { OPPORTUNITY_PREF_LABEL } from '@/lib/candidateIntent'
import { trackPushSubscribe, trackPushUnsubscribe } from '@/lib/analytics'
import type { Profile } from '@/lib/supabase'

const FeedbackModal = lazy(() => import('@/components/FeedbackModal'))

/**
 * Phone Settings (Figma Settings v2 · Settings — Notifications · Settings —
 * Privacy). Hub in the order a player needs it: who you are → whether you're
 * available → preferences → account → support → sign out; Delete account is
 * deliberately small and last. Every row maps to an existing column — see the
 * DEV NOTE frames under the three screens.
 */
export type SettingsSection = 'hub' | 'notifications' | 'privacy' | 'blocked'

type BoolColumn =
  | 'open_to_play' | 'open_to_opportunities' | 'notify_push'
  | 'notify_messages' | 'notify_applications' | 'notify_opportunities' | 'notify_friends' | 'notify_references' | 'notify_profile_views'
  | 'browse_anonymously' | 'show_last_active' | 'contact_email_public'

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function longDate(iso: string | null | undefined): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  return m ? `${Number(m[3])} ${MONTH[Number(m[2]) - 1]} ${m[1]}` : null
}
const PROVIDER: Record<string, string> = { google: 'Google', apple: 'Apple', email: 'email' }

function useProfileWriter() {
  const { user, profile, refreshProfile } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  // Optimistic overrides, dropped once the refreshed profile agrees.
  const [pending, setPending] = useState<Partial<Record<string, unknown>>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const read = <T,>(column: keyof Profile, fallback: T): T => (column in pending ? (pending[column as string] as T) : ((profile?.[column] as T | null | undefined) ?? fallback))

  const write = async (patch: Partial<Record<keyof Profile, unknown>>, key: string) => {
    if (!user) return false
    setBusy(key)
    setPending((p) => ({ ...p, ...patch }))
    try {
      const { error } = await supabase.from('profiles').update(patch as never).eq('id', user.id)
      if (error) throw error
      await refreshProfile()
      return true
    } catch (err) {
      logger.error('[SettingsMobile] update failed', err)
      addToast('Could not save that. Please try again.', 'error')
      return false
    } finally {
      setPending((p) => { const next = { ...p }; for (const k of Object.keys(patch)) delete next[k]; return next })
      setBusy(null)
    }
  }
  const toggle = (column: BoolColumn, fallback: boolean) => write({ [column]: !read<boolean>(column, fallback) } as Partial<Record<keyof Profile, unknown>>, column)
  return { read, write, toggle, busy }
}

function Screen({ parent, title, onBack, children }: { parent: string; title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-grouped pb-28 lg:hidden" data-testid={`settings-${title.toLowerCase().replace(/\W+/g, '-')}`}>
      <div className="sticky top-0 z-20 bg-surface-grouped pt-[env(safe-area-inset-top)]">
        <DetailNavBar parent={parent} onBack={onBack} />
      </div>
      <h1 className="px-5 pb-1 text-large-title text-ink-1">{title}</h1>
      <div className="px-4">{children}</div>
    </div>
  )
}

function Hub({ go }: { go: (s: SettingsSection | 'account') => void }) {
  const navigate = useNavigate()
  const { user, profile, signOut } = useAuthStore()
  const { read, write, toggle, busy } = useProfileWriter()
  const [lookingFor, setLookingFor] = useState(false)
  const [legal, setLegal] = useState(false)
  const [feedback, setFeedback] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const provider = PROVIDER[(user?.app_metadata?.provider as string | undefined) ?? 'email'] ?? 'email'
  const preference = read<string | null>('opportunity_preference', null)
  const visibility = read<string>('highlight_visibility', 'recruiters')
  const languages = (profile?.languages ?? []).filter(Boolean)
  const dob = longDate(profile?.date_of_birth)
  const name = profile?.full_name?.trim() || 'Your profile'
  const recruitable = isRecruitableRole(profile?.role)
  const isClub = profile?.role === 'club'

  return (
    <Screen parent="Profile" title="Settings" onBack={() => navigate('/dashboard/profile')}>
      <SettingsGroup>
        <button type="button" onClick={() => navigate('/dashboard/profile?action=edit')} className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left">
          <EntityAvatar src={profile?.avatar_url ? getImageUrl(profile.avatar_url, 'avatar-md') ?? profile.avatar_url : null} name={name} role={profile?.role} size={64} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-semibold text-ink-1">{name}</span>
            <span className="block truncate text-secondary text-ink-2">{user?.email}</span>
            <span className="block truncate text-secondary text-ink-3">{roleLabel(profile?.role)} · signed in with {provider}</span>
          </span>
        </button>
      </SettingsGroup>

      {isClub && (
        <SettingsGroup label="Club">
          <SettingsRow title="Club & league" icon={<Shield className="h-4 w-4" strokeWidth={2} />} onClick={() => navigate('/dashboard/profile?tab=league')} />
        </SettingsGroup>
      )}

      {recruitable && (
      <SettingsGroup label="Availability" footer="Clubs filter by this. Your week asks you to confirm it now and then.">
        <SettingsRow title="Open to play" subtitle="Shown on your profile and in Community." trailing={<SettingsSwitch label="Open to play" checked={read('open_to_play', false)} disabled={busy === 'open_to_play'} onChange={() => void toggle('open_to_play', false)} />} />
        <SettingsRow title="Open to opportunities" subtitle="Clubs and coaches can reach out about roles." trailing={<SettingsSwitch label="Open to opportunities" checked={read('open_to_opportunities', false)} disabled={busy === 'open_to_opportunities'} onChange={() => void toggle('open_to_opportunities', false)} />} />
        <SettingsRow title="Looking for" subtitle={preference ? `${OPPORTUNITY_PREF_LABEL[preference] ?? preference} roles` : 'Not set'} onClick={() => setLookingFor(true)} />
      </SettingsGroup>
      )}

      <SettingsGroup label="Preferences">
        <SettingsRow title="Notifications" value="Per type" icon={<Bell className="h-4 w-4" strokeWidth={2} />} onClick={() => go('notifications')} />
        <SettingsRow title="Privacy" value={!isClub ? (visibility === 'public' ? 'Everyone' : 'Clubs & coaches') : undefined} icon={<Lock className="h-4 w-4" strokeWidth={2} />} iconClassName="bg-positive-soft text-positive" onClick={() => go('privacy')} />
        <SettingsRow title="Language" value="English" icon={<Languages className="h-4 w-4" strokeWidth={2} />} iconClassName="bg-[#e8edfd] text-[#3b5bdb]" />
      </SettingsGroup>

      <SettingsGroup label="Account" footer={isClub ? undefined : 'Date of birth is only used to keep Hockia 16+. It never shows on your profile.'}>
        <SettingsRow title="Email & sign-in" value={provider === 'email' ? 'Email' : provider} onClick={() => go('account')} />
        {!isClub && dob && <SettingsRow title="Date of birth" value={dob} />}
        {!isClub && languages.length > 0 && <SettingsRow title="Languages" subtitle={languages.join(' · ')} />}
      </SettingsGroup>

      <SettingsGroup label="Support">
        <SettingsRow title="Help centre" icon={<HelpCircle className="h-4 w-4" strokeWidth={2} />} onClick={() => { window.location.href = 'mailto:team@inhockia.com' }} />
        <SettingsRow title="Send feedback" icon={<MessageSquare className="h-4 w-4" strokeWidth={2} />} onClick={() => setFeedback(true)} />
        <SettingsRow title="Terms & privacy policy" icon={<FileText className="h-4 w-4" strokeWidth={2} />} onClick={() => setLegal(true)} />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow title={signingOut ? 'Signing out…' : 'Sign out'} chevron={false} onClick={() => { setSigningOut(true); void signOut().finally(() => setSigningOut(false)) }} />
      </SettingsGroup>

      <button type="button" onClick={() => setDeleting(true)} className="mx-auto mt-6 block py-2 text-row font-semibold text-red-600">Delete account</button>
      <p className="pt-1 text-center text-caption text-ink-3">Hockia · Made for field hockey</p>

      <BottomSheet open={lookingFor} onClose={() => setLookingFor(false)} ariaLabel="Looking for">
        <div className="px-5 pb-3 pt-1">
          <h2 className="text-title text-ink-1">Looking for</h2>
          <p className="mt-1 text-secondary text-ink-2">Clubs filter by this.</p>
          <div className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
            {(['paid', 'development', 'either'] as const).map((value) => (
              <button key={value} type="button" onClick={() => { void write({ opportunity_preference: value }, 'opportunity_preference'); setLookingFor(false) }} className="flex h-[50px] w-full items-center justify-between px-4 text-left text-body text-ink-1">
                {OPPORTUNITY_PREF_LABEL[value]} roles
                {preference === value && <Check className="h-5 w-5 text-hockia-primary" strokeWidth={2.4} />}
              </button>
            ))}
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={legal} onClose={() => setLegal(false)} ariaLabel="Terms and privacy policy">
        <div className="px-5 pb-3 pt-1">
          <h2 className="text-title text-ink-1">Terms &amp; privacy policy</h2>
          <div className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
            <SettingsRow title="Terms of service" onClick={() => navigate('/terms')} />
            <SettingsRow title="Privacy policy" onClick={() => navigate('/privacy-policy')} />
          </div>
        </div>
      </BottomSheet>

      {feedback && <Suspense fallback={null}><FeedbackModal open={feedback} onClose={() => setFeedback(false)} /></Suspense>}
      <DeleteAccountModal isOpen={deleting} onClose={() => setDeleting(false)} userEmail={user?.email ?? ''} />
    </Screen>
  )
}

type Kind = { column: Extract<BoolColumn, `notify_${string}`>; title: string; subtitle: string; recruitableOnly?: boolean }
const KINDS: Kind[] = [
  { column: 'notify_messages', title: 'Messages', subtitle: 'From clubs, coaches and friends.' },
  { column: 'notify_applications', title: 'My applications', subtitle: 'A club replied, shortlisted you, or a role closed.', recruitableOnly: true },
  { column: 'notify_opportunities', title: 'New roles', subtitle: 'New roles for your position, team and passports.', recruitableOnly: true },
  { column: 'notify_friends', title: 'Friend requests', subtitle: 'New requests and accepted ones.' },
  { column: 'notify_references', title: 'References', subtitle: 'A friend asks for one, or writes you one.' },
  { column: 'notify_profile_views', title: 'Profile views', subtitle: 'Weekly summary of who looked at you.' },
]

/** Clubs don't apply to roles, so no My applications / New roles for them. */
function kindsFor(role: string | null | undefined): Kind[] {
  return role === 'club' ? KINDS.filter((k) => !k.recruitableOnly) : KINDS
}

function Notifications({ back }: { back: () => void }) {
  const { user, profile } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const push = usePushSubscription()
  const { read, write, toggle, busy } = useProfileWriter()

  // Push is on when the account allows it (notify_push, the master) AND this
  // device is subscribed.
  const pushOn = read('notify_push', true) && push.isSubscribed
  const togglePush = async () => {
    try {
      if (pushOn) {
        await write({ notify_push: false }, 'notify_push')
        await push.unsubscribe()
        trackPushUnsubscribe()
      } else {
        if (!push.isSubscribed) { await push.subscribe(); trackPushSubscribe('settings') }
        await write({ notify_push: true }, 'notify_push')
      }
    } catch (err) {
      logger.error('[SettingsMobile] push toggle failed', err)
      addToast("Couldn't update push notifications. If it keeps failing, check Notifications for Hockia in your phone's settings.", 'error')
    }
  }

  return (
    <Screen parent="Settings" title="Notifications" onBack={back}>
      {/* Push is the only channel that can be switched as a whole. Email has no
          master flag, so it is not a row — a row that looks like a setting but
          can't be changed teaches people to distrust the screen. */}
      <SettingsGroup
        label="Channels"
        footer={<>Turn push off and nothing below arrives that way. In-app notifications always stay on.{user?.email ? <> Email goes to {user.email} — choose what arrives per type below.</> : null}</>}
      >
        <SettingsRow
          title="Push notifications"
          subtitle={!push.isSupported ? 'Not available on this device' : push.permission === 'denied' ? 'Blocked in your phone’s settings' : 'On this device'}
          trailing={<SettingsSwitch label="Push notifications" checked={pushOn} disabled={!push.isSupported || push.loading || busy === 'notify_push'} onChange={() => void togglePush()} />}
        />
      </SettingsGroup>

      <SettingsGroup label="Tell me about" trailingLabels={['Push', 'Email']} footer="Push and Email move together for now — each type has one setting. Email for messages and profile views is bundled into a digest, never one email per event.">
        {kindsFor(profile?.role).map((k) => {
          const on = read<boolean>(k.column, true)
          return (
            <SettingsRow
              key={k.column}
              title={k.title}
              subtitle={k.subtitle}
              trailing={
                <span className="flex shrink-0 gap-2">
                  <SettingsSwitch label={`${k.title} — push`} checked={on && pushOn} disabled={!pushOn || busy === k.column} onChange={() => void toggle(k.column, true)} />
                  <SettingsSwitch label={`${k.title} — email`} checked={on} disabled={busy === k.column} onChange={() => void toggle(k.column, true)} />
                </span>
              }
            />
          )
        })}
      </SettingsGroup>
    </Screen>
  )
}

function Privacy({ back, go }: { back: () => void; go: (s: SettingsSection) => void }) {
  const { read, write, toggle, busy } = useProfileWriter()
  const { blockedIds } = useBlockedUsers()
  const isClub = useAuthStore((st) => st.profile?.role) === 'club'
  const visibility = read<string>('highlight_visibility', 'recruiters')
  const options = useMemo(() => [
    { value: 'recruiters', title: 'Clubs & coaches', subtitle: 'Recruiters only. Highlights and reels stay public.' },
    { value: 'public', title: 'Everyone on Hockia', subtitle: 'Any signed-in member.' },
  ], [])

  return (
    <Screen parent="Settings" title="Privacy" onBack={back}>
      {!isClub && (
      <SettingsGroup label="Default for new full matches" footer="Full matches carry the most detail about how you play, so they are locked to recruiters by default. You can change any single video from Manage media.">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={visibility === o.value} disabled={busy === 'highlight_visibility'} onClick={() => { if (visibility !== o.value) void write({ highlight_visibility: o.value }, 'highlight_visibility') }} className="flex w-full items-center gap-3 px-4 py-3 text-left">
            <span className="min-w-0 flex-1">
              <span className="block text-body text-ink-1">{o.title}</span>
              <span className="block text-secondary text-ink-2">{o.subtitle}</span>
            </span>
            {visibility === o.value && <Check className="h-5 w-5 shrink-0 text-hockia-primary" strokeWidth={2.4} />}
          </button>
        ))}
      </SettingsGroup>
      )}

      <SettingsGroup label="Visibility">
        <SettingsRow title="Browse anonymously" subtitle="Clubs won’t see that you looked at them — and you won’t see who looked at you." trailing={<SettingsSwitch label="Browse anonymously" checked={read('browse_anonymously', false)} disabled={busy === 'browse_anonymously'} onChange={() => void toggle('browse_anonymously', false)} />} />
        <SettingsRow title="Show when I was last active" subtitle="“Active today” on your profile and in Chat." trailing={<SettingsSwitch label="Show when I was last active" checked={read('show_last_active', true)} disabled={busy === 'show_last_active'} onChange={() => void toggle('show_last_active', true)} />} />
        <SettingsRow title="Show my contact email" subtitle="Off: clubs see it only once they reply to your application." trailing={<SettingsSwitch label="Show my contact email" checked={read('contact_email_public', false)} disabled={busy === 'contact_email_public'} onChange={() => void toggle('contact_email_public', false)} />} />
      </SettingsGroup>

      <SettingsGroup label="Safety" footer="Blocked members can’t message you, see your profile, or find you in Community.">
        <SettingsRow title="Blocked members" value={blockedIds.size === 0 ? 'None' : String(blockedIds.size)} onClick={() => go('blocked')} />
      </SettingsGroup>
    </Screen>
  )
}

export default function SettingsMobile({ section }: { section: SettingsSection }) {
  const navigate = useNavigate()
  const go = (s: SettingsSection | 'account') => navigate(s === 'hub' ? '/settings' : `/settings/${s}`)
  if (section === 'notifications') return <Notifications back={() => go('hub')} />
  if (section === 'privacy') return <Privacy back={() => go('hub')} go={go} />
  if (section === 'blocked') {
    return (
      <Screen parent="Privacy" title="Blocked members" onBack={() => go('privacy')}>
        <div className="mt-2 overflow-hidden rounded-card bg-white p-4"><BlockedAccountsList /></div>
      </Screen>
    )
  }
  return <Hub go={go} />
}
