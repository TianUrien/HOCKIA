import { lazy, Suspense, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, ChevronRight, FileText, HelpCircle, Lock, MessageSquare } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { buttonClassName } from '@/components/ui/buttonClasses'
import BlockedAccountsList from '@/components/BlockedAccountsList'
import DeleteAccountModal from '@/components/DeleteAccountModal'
import { ContactEmailPublicRow, SettingsGroup, SettingsRow, SettingsSwitch, SheetActions } from './settingsUi'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { usePushSubscription } from '@/hooks/usePushSubscription'
import { useProfileWriter, type ProfileBoolColumn as BoolColumn } from '@/hooks/useProfileWriter'
import { useFullMatchPrivacyNotice } from '@/hooks/useFullMatchPrivacyNotice'
import { useBlockedUsers } from '@/hooks/useBlockedUsers'
import { roleLabel } from '@/lib/identity'
import { getImageUrl } from '@/lib/imageUrl'
import { isRecruitableRole } from '@/lib/settingsRoles'
import { dayFirst } from '@/lib/dayFirst'
import { LanguageSwitch } from '@/components/LanguageSwitch'
import { useCommonT } from '@/i18n/ns/common'
import { tSettings, useSettingsT } from '@/i18n/ns/settings'
import { trackPushSubscribe, trackPushUnsubscribe } from '@/lib/analytics'
import { qk } from '@/lib/queryKeys'
import { squadSettingsSubtitle } from '@/lib/clubSquadCopy'
import { CLUB_EDIT_PATH, clubGroupFooter, contactEmailIntro, clubLeagueSubtitle, contactEmailSubtitle, isValidContactEmail } from '@/lib/clubSettingsCopy'

const FeedbackModal = lazy(() => import('@/components/FeedbackModal'))

/** Club → Squad & invites (Figma D1.22 353:1078) → Squad — own (D1.15). */
function SquadSettingsRow({ clubId, onOpen }: { clubId: string | null; onOpen: () => void }) {
  const { data } = useQuery({
    queryKey: qk.clubMemberCount(clubId),
    enabled: Boolean(clubId),
    staleTime: 30_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase.rpc('get_club_members', { p_profile_id: clubId!, p_limit: 1, p_offset: 0 })
      if (error) throw error
      return rows && rows.length > 0 ? rows[0].total_count : 0
    },
  })
  const t = useSettingsT()
  return <SettingsRow title={t('club.squad')} subtitle={squadSettingsSubtitle(data)} onClick={onOpen} />
}

/** Club → Contact email (DEV NOTE 355:927: contact_email, contact_email_public, default private). */
function ContactEmailSheet({ open, onClose, email, isPublic, busy, onSave }: { open: boolean; onClose: () => void; email: string; isPublic: boolean; busy: boolean; onSave: (email: string | null, isPublic: boolean) => Promise<boolean> }) {
  const t = useSettingsT()
  const [value, setValue] = useState(email)
  const [pub, setPub] = useState(isPublic)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    if (!isValidContactEmail(value)) { setError(t('errors.contactEmailInvalid')); return }
    const trimmed = value.trim()
    if (await onSave(trimmed || null, trimmed ? pub : false)) onClose()
  }
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('contactEmail.title')}>
      <div className="px-5 pb-3 pt-1" data-testid="contact-email-sheet">
        <h2 className="text-title text-ink-1">{t('contactEmail.title')}</h2>
        <p className="mt-1 text-secondary text-ink-2">{contactEmailIntro()}</p>
        <input
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null) }}
          placeholder={t('contactEmail.placeholder')}
          aria-label={t('contactEmail.title')}
          className="mt-3 h-12 w-full rounded-[12px] bg-surface-grouped px-4 text-[17px] text-ink-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/30"
        />
        {error && <p role="alert" className="pt-1.5 text-[13px] text-red-600">{error}</p>}
        <div className="mt-3">
          <ContactEmailPublicRow checked={pub && value.trim() !== ''} disabled={value.trim() === ''} onChange={() => setPub((v) => !v)} />
        </div>
        <div className="mt-4">
          <SheetActions onCancel={onClose} onSave={() => void save()} saving={busy} />
        </div>
      </div>
    </BottomSheet>
  )
}

/**
 * Phone Settings (Figma Settings v2 · Settings — Notifications · Settings —
 * Privacy). Hub in the order a player needs it: who you are → whether you're
 * available → preferences → account → support → sign out; Delete account is
 * deliberately small and last. Every row maps to an existing column — see the
 * DEV NOTE frames under the three screens.
 */
export type SettingsSection = 'hub' | 'notifications' | 'privacy' | 'blocked'

function longDate(iso: string | null | undefined): string | null {
  const m = iso ? /^\d{4}-\d{2}-\d{2}/.exec(iso) : null
  return m ? dayFirst(m[0], { year: 'always' }) : null
}
/** Accurate DOB copy: the profile shows the age (key facts), never the date;
 *  for players it also keeps club-facing search 18+ (D2 search fence). */
/** "Paid opportunities"; a value the catalog does not know is shown as stored. */
function lookingForLabel(preference: string): string {
  return preference === 'paid' || preference === 'development' || preference === 'either'
    ? tSettings(`lookingFor.${preference}`)
    : tSettings('lookingFor.other', { preference })
}

function dobFooter(isPlayer: boolean): string {
  return isPlayer ? tSettings('accountGroup.dobFooterPlayer') : tSettings('accountGroup.dobFooter')
}

/** Sign-in providers shown by name; anything else reads as "email". */
const PROVIDER: Record<string, string> = { google: 'Google', apple: 'Apple' }

/** `id` names the screen in its test id; it stays the same in every language. */
function Screen({ id, parent, title, onBack, children }: { id: string; parent: string; title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-grouped pb-28 lg:hidden" data-testid={`settings-${id}`}>
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
  const t = useSettingsT()
  const tc = useCommonT()
  const { user, profile, signOut } = useAuthStore()
  const { read, write, toggle, busy } = useProfileWriter()
  const [lookingFor, setLookingFor] = useState(false)
  const [legal, setLegal] = useState(false)
  const [feedback, setFeedback] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [contactEmail, setContactEmail] = useState(false)

  const providerName = PROVIDER[(user?.app_metadata?.provider as string | undefined) ?? 'email']
  const provider = providerName ?? t('hub.providerEmail')
  const preference = read<string | null>('opportunity_preference', null)
  const fullMatches = read<string>('full_match_visibility', 'recruiters')
  const isPlayer = profile?.role === 'player'
  const languages = (profile?.languages ?? []).filter(Boolean)
  const languageList = languages.join(', ')
  const languageGroupLabel = tc('language.label')
  const dob = longDate(profile?.date_of_birth)
  const name = profile?.full_name?.trim() || t('hub.fallbackName')
  const recruitable = isRecruitableRole(profile?.role)
  const isClub = profile?.role === 'club'

  return (
    <Screen id="settings" parent={t('hub.parent')} title={t('hub.title')} onBack={() => navigate('/dashboard/profile')}>
      <SettingsGroup>
        <button type="button" onClick={() => navigate(isClub ? `${CLUB_EDIT_PATH}?from=settings` : '/dashboard/profile?action=edit')} className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left" data-testid="settings-identity">
          <EntityAvatar src={profile?.avatar_url ? getImageUrl(profile.avatar_url, 'avatar-md') ?? profile.avatar_url : null} name={name} role={profile?.role} size={64} />
          {isClub ? (
            // Figma D1.22: crest, club name, "Signed in with email", "Club · admin".
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold text-ink-1">{name}</span>
              <span className="block truncate text-secondary text-ink-2">{t('hub.signedInWith', { provider })}</span>
              <span className="block truncate text-secondary text-ink-3">{t('hub.clubAdmin')}</span>
            </span>
          ) : (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold text-ink-1">{name}</span>
              <span className="block truncate text-secondary text-ink-2">{user?.email}</span>
              <span className="block truncate text-secondary text-ink-3">{t('hub.roleSignedIn', { role: roleLabel(profile?.role), provider })}</span>
            </span>
          )}
          {isClub && <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} aria-hidden="true" />}
        </button>
      </SettingsGroup>

      {isClub && (
        <SettingsGroup label={t('club.label')} footer={clubGroupFooter()}>
          <SettingsRow title={t('club.clubLeague')} subtitle={clubLeagueSubtitle(profile ?? {})} onClick={() => navigate('/dashboard/profile?tab=league&from=settings')} />
          <SquadSettingsRow clubId={profile?.id ?? null} onOpen={() => navigate('/dashboard/profile/members?from=settings')} />
          <SettingsRow title={t('club.contactEmail')} subtitle={contactEmailSubtitle(read<string | null>('contact_email', null), read<boolean>('contact_email_public', false))} onClick={() => setContactEmail(true)} />
        </SettingsGroup>
      )}

      {recruitable && (
      <SettingsGroup label={t('availability.label')} footer={t('availability.footer')}>
        {isPlayer ? (
          // D2.4: players set Open to play on its own screen (switch + when + consent).
          <SettingsRow title={t('availability.openToPlay')} subtitle={t('availability.openToPlayBody')} value={read('open_to_play', false) ? t('availability.on') : t('availability.off')} onClick={() => navigate('/dashboard/profile/open-to-play')} />
        ) : (
          // Coaches: their own flag (open_to_coach), same as the desktop availability strip.
          <SettingsRow title={t('availability.openToCoach')} subtitle={t('availability.openToCoachBody')} trailing={<SettingsSwitch label={t('availability.openToCoach')} checked={read('open_to_coach', false)} disabled={busy === 'open_to_coach'} onChange={() => void toggle('open_to_coach', false)} />} />
        )}
        <SettingsRow title={t('availability.openToOpportunities')} subtitle={t('availability.openToOpportunitiesBody')} trailing={<SettingsSwitch label={t('availability.openToOpportunities')} checked={read('open_to_opportunities', false)} disabled={busy === 'open_to_opportunities'} onChange={() => void toggle('open_to_opportunities', false)} />} />
        <SettingsRow title={t('availability.lookingFor')} subtitle={preference ? lookingForLabel(preference) : t('availability.notSet')} onClick={() => setLookingFor(true)} />
        {/* Players only, off by default: brands that sell where you live can invite you (2026-11-07). */}
        {isPlayer && <SettingsRow title={t('availability.brandPartnerships')} subtitle={t('availability.brandPartnershipsBody')} onClick={() => navigate('/settings/brand-partnerships')} />}
      </SettingsGroup>
      )}

      <SettingsGroup label={t('preferences.label')}>
        <SettingsRow title={t('preferences.notifications')} value={t('preferences.perType')} icon={<Bell className="h-4 w-4" strokeWidth={2} />} onClick={() => go('notifications')} />
        <SettingsRow title={t('preferences.privacy')} value={isPlayer ? (fullMatches === 'public' ? t('preferences.everyone') : t('preferences.clubsCoaches')) : undefined} icon={<Lock className="h-4 w-4" strokeWidth={2} />} onClick={() => go('privacy')} />
      </SettingsGroup>

      <SettingsGroup label={languageGroupLabel}>
        <div className="px-4 py-3">
          <LanguageSwitch />
        </div>
      </SettingsGroup>

      <SettingsGroup label={t('accountGroup.label')} footer={isClub ? undefined : dobFooter(isPlayer)}>
        <SettingsRow title={t('accountGroup.emailSignIn')} value={providerName ?? t('accountGroup.emailValue')} onClick={() => go('account')} />
        {!isClub && dob && <SettingsRow title={t('accountGroup.dob')} value={dob} />}
        {!isClub && languages.length > 0 && <SettingsRow title={t('accountGroup.languages')} subtitle={languageList} />}
      </SettingsGroup>

      <SettingsGroup label={t('support.label')}>
        <SettingsRow title={t('support.help')} icon={<HelpCircle className="h-4 w-4" strokeWidth={2} />} onClick={() => { window.location.href = 'mailto:team@inhockia.com' }} />
        <SettingsRow title={t('support.feedback')} icon={<MessageSquare className="h-4 w-4" strokeWidth={2} />} onClick={() => setFeedback(true)} />
        <SettingsRow title={t('support.legal')} icon={<FileText className="h-4 w-4" strokeWidth={2} />} onClick={() => setLegal(true)} />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow title={signingOut ? t('hub.signingOut') : t('hub.signOut')} chevron={false} onClick={() => { setSigningOut(true); void signOut().finally(() => setSigningOut(false)) }} />
      </SettingsGroup>

      {/* Last and quiet: Destructive (soft) Small opens the confirmation. */}
      <div className="mt-6 flex justify-center">
        <button type="button" onClick={() => setDeleting(true)} className={buttonClassName({ variant: 'destructive', size: 'small', radius: 'rounded-full' })} data-testid="settings-delete-account">{t('hub.deleteAccount')}</button>
      </div>
      <p className="pt-3 text-center text-caption text-ink-3">{t('hub.madeFor')}</p>

      {isClub && contactEmail && (
        <ContactEmailSheet
          open
          onClose={() => setContactEmail(false)}
          email={read<string | null>('contact_email', null) ?? ''}
          isPublic={read<boolean>('contact_email_public', false)}
          busy={busy === 'contact_email'}
          onSave={(email, isPublic) => write({ contact_email: email, contact_email_public: isPublic }, 'contact_email')}
        />
      )}

      <BottomSheet open={lookingFor} onClose={() => setLookingFor(false)} ariaLabel={t('lookingFor.title')}>
        <div className="px-5 pb-3 pt-1">
          <h2 className="text-title text-ink-1">{t('lookingFor.title')}</h2>
          <p className="mt-1 text-secondary text-ink-2">{t('lookingFor.hint')}</p>
          <div className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
            {(['paid', 'development', 'either'] as const).map((value) => (
              <button key={value} type="button" onClick={() => { void write({ opportunity_preference: value }, 'opportunity_preference'); setLookingFor(false) }} className="flex h-[50px] w-full items-center justify-between px-4 text-left text-body text-ink-1">
                {t(`lookingFor.${value}`)}
                {preference === value && <Check className="h-5 w-5 text-hockia-primary" strokeWidth={2.4} />}
              </button>
            ))}
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={legal} onClose={() => setLegal(false)} ariaLabel={t('legal.label')}>
        <div className="px-5 pb-3 pt-1">
          <h2 className="text-title text-ink-1">{t('legal.title')}</h2>
          <div className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
            <SettingsRow title={t('legal.terms')} onClick={() => navigate('/terms')} />
            <SettingsRow title={t('legal.privacy')} onClick={() => navigate('/privacy-policy')} />
          </div>
        </div>
      </BottomSheet>

      {feedback && <Suspense fallback={null}><FeedbackModal open={feedback} onClose={() => setFeedback(false)} /></Suspense>}
      <DeleteAccountModal isOpen={deleting} onClose={() => setDeleting(false)} userEmail={user?.email ?? ''} />
    </Screen>
  )
}

/** `copy` is the key stem in the settings catalog: kinds.<copy>Title / kinds.<copy>Body. */
type Kind = { column: Extract<BoolColumn, `notify_${string}`>; copy: 'messages' | 'applications' | 'opportunities' | 'friends' | 'references' | 'profileViews'; recruitableOnly?: boolean }
const KINDS: Kind[] = [
  { column: 'notify_messages', copy: 'messages' },
  { column: 'notify_applications', copy: 'applications', recruitableOnly: true },
  { column: 'notify_opportunities', copy: 'opportunities', recruitableOnly: true },
  { column: 'notify_friends', copy: 'friends' },
  { column: 'notify_references', copy: 'references' },
  { column: 'notify_profile_views', copy: 'profileViews' },
]

/** Clubs don't apply to roles, so no My applications / New roles for them. */
function kindsFor(role: string | null | undefined): Kind[] {
  return role === 'club' ? KINDS.filter((k) => !k.recruitableOnly) : KINDS
}

function Notifications({ back }: { back: () => void }) {
  const t = useSettingsT()
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
      addToast(t('errors.pushFailed'), 'error')
    }
  }

  return (
    <Screen id="notifications" parent={t('notifications.parent')} title={t('notifications.title')} onBack={back}>
      {/* Push is the only channel that can be switched as a whole. Email has no
          master flag, so it is not a row — a row that looks like a setting but
          can't be changed teaches people to distrust the screen. */}
      <SettingsGroup
        label={t('notifications.channels')}
        footer={user?.email ? t('notifications.channelsFooterEmail', { email: user.email }) : t('notifications.channelsFooter')}
      >
        <SettingsRow
          title={t('notifications.pushTitle')}
          subtitle={!push.isSupported ? t('notifications.pushUnsupported') : push.permission === 'denied' ? t('notifications.pushBlocked') : t('notifications.pushOnDevice')}
          trailing={<SettingsSwitch label={t('notifications.pushTitle')} checked={pushOn} disabled={!push.isSupported || push.loading || busy === 'notify_push'} onChange={() => void togglePush()} />}
        />
      </SettingsGroup>

      <SettingsGroup label={t('notifications.tellMe')} trailingLabels={[t('notifications.colPush'), t('notifications.colEmail')]} footer={t('notifications.tellMeFooter')}>
        {kindsFor(profile?.role).map((k) => {
          const on = read<boolean>(k.column, true)
          const title = t(`kinds.${k.copy}Title`)
          return (
            <SettingsRow
              key={k.column}
              title={title}
              subtitle={t(`kinds.${k.copy}Body`)}
              trailing={
                <span className="flex shrink-0 gap-2">
                  <SettingsSwitch label={t('notifications.pushSwitch', { title })} checked={on && pushOn} disabled={!pushOn || busy === k.column} onChange={() => void toggle(k.column, true)} />
                  <SettingsSwitch label={t('notifications.emailSwitch', { title })} checked={on} disabled={busy === k.column} onChange={() => void toggle(k.column, true)} />
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
  const t = useSettingsT()
  const { read, write, toggle, busy } = useProfileWriter()
  const { blockedIds } = useBlockedUsers()
  const { profile } = useAuthStore()
  const { resolveNotice } = useFullMatchPrivacyNotice()
  const visibility = read<string>('full_match_visibility', 'recruiters')
  const options = useMemo(() => [
    { value: 'recruiters', title: t('mobilePrivacy.recruitersTitle'), subtitle: t('mobilePrivacy.recruitersBody') },
    { value: 'public', title: t('mobilePrivacy.publicTitle'), subtitle: t('mobilePrivacy.publicBody') },
  ], [t])
  const choose = async (value: string) => {
    if (visibility === value) return
    // Answering here also answers the one-time notice, so it never re-asks.
    if (await write({ full_match_visibility: value }, 'full_match_visibility')) void resolveNotice(value === 'public')
  }

  return (
    <Screen id="privacy" parent={t('mobilePrivacy.parent')} title={t('mobilePrivacy.title')} onBack={back}>
      {profile?.role === 'player' && (
        <SettingsGroup label={t('mobilePrivacy.fullMatchLabel')} footer={t('mobilePrivacy.fullMatchFooter')}>
          {options.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={visibility === o.value} disabled={busy === 'full_match_visibility'} onClick={() => void choose(o.value)} className="flex w-full items-center gap-3 px-4 py-3 text-left" data-testid={`full-match-visibility-${o.value}`}>
              <span className="min-w-0 flex-1">
                <span className="block text-body text-ink-1">{o.title}</span>
                <span className="block text-secondary text-ink-2">{o.subtitle}</span>
              </span>
              {visibility === o.value && <Check className="h-5 w-5 shrink-0 text-hockia-primary" strokeWidth={2.4} />}
            </button>
          ))}
        </SettingsGroup>
      )}

      <SettingsGroup label={t('mobilePrivacy.visibility')}>
        <SettingsRow title={t('mobilePrivacy.anonymous')} subtitle={t('mobilePrivacy.anonymousBody')} trailing={<SettingsSwitch label={t('mobilePrivacy.anonymous')} checked={read('browse_anonymously', false)} disabled={busy === 'browse_anonymously'} onChange={() => void toggle('browse_anonymously', false)} />} />
        <SettingsRow title={t('mobilePrivacy.lastActive')} subtitle={t('mobilePrivacy.lastActiveBody')} trailing={<SettingsSwitch label={t('mobilePrivacy.lastActive')} checked={read('show_last_active', true)} disabled={busy === 'show_last_active'} onChange={() => void toggle('show_last_active', true)} />} />
        {/* Clubs set their contact email under Settings › Club (D1.22). */}
        {profile?.role !== 'club' && (
          <SettingsRow title={t('mobilePrivacy.contactEmail')} subtitle={t('mobilePrivacy.contactEmailBody')} trailing={<SettingsSwitch label={t('mobilePrivacy.contactEmail')} checked={read('contact_email_public', false)} disabled={busy === 'contact_email_public'} onChange={() => void toggle('contact_email_public', false)} />} />
        )}
      </SettingsGroup>

      <SettingsGroup label={t('mobilePrivacy.safety')} footer={t('mobilePrivacy.safetyFooter')}>
        <SettingsRow title={t('mobilePrivacy.blocked')} value={blockedIds.size === 0 ? t('mobilePrivacy.none') : String(blockedIds.size)} onClick={() => go('blocked')} />
      </SettingsGroup>
    </Screen>
  )
}

export default function SettingsMobile({ section }: { section: SettingsSection }) {
  const navigate = useNavigate()
  const t = useSettingsT()
  const go = (s: SettingsSection | 'account') => navigate(s === 'hub' ? '/settings' : `/settings/${s}`)
  if (section === 'notifications') return <Notifications back={() => go('hub')} />
  if (section === 'privacy') return <Privacy back={() => go('hub')} go={go} />
  if (section === 'blocked') {
    return (
      <Screen id="blocked-members" parent={t('blocked.parent')} title={t('blocked.title')} onBack={() => go('privacy')}>
        <div className="mt-2 overflow-hidden rounded-card bg-white p-4"><BlockedAccountsList /></div>
      </Screen>
    )
  }
  return <Hub go={go} />
}
