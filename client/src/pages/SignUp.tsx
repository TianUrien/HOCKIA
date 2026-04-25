import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, User, Building2, Briefcase, Store, Flag } from 'lucide-react'
import { InAppBrowserWarning } from '@/components'
import AuthScreen from './AuthScreen'

type UserRole = 'player' | 'coach' | 'club' | 'brand' | 'umpire'

/**
 * SignUp — role selection, then hands off to AuthScreen (mode="signup").
 *
 * Step 1 (this file): pick a role. Role is the only thing HOCKIA needs
 * before a new account exists — everything else (auth method, email,
 * profile data) is collected downstream.
 *
 * Step 2 (AuthScreen mode="signup"): OAuth + magic-link + password,
 * all sharing a single email field. Follows the 2026 research memo
 * (OAuth top, Apple HIG-first, progressive-disclosure password).
 */
// Accent classes are spelled out explicitly so Tailwind's JIT purge keeps
// them in the bundle. Dynamic `bg-[${color}]/10` template strings get
// stripped because the scanner can't prove the full class name exists.
const ROLE_CARDS: Array<{
  role: UserRole
  label: string
  description: string
  iconBg: string
  iconText: string
  Icon: typeof User
}> = [
  {
    role: 'player',
    label: 'Join as Player',
    description: 'Showcase your skills and connect with clubs',
    iconBg: 'bg-[#8026FA]/10',
    iconText: 'text-[#8026FA]',
    Icon: User,
  },
  {
    role: 'coach',
    label: 'Join as Coach',
    description: 'Find opportunities and mentor players',
    iconBg: 'bg-[#924CEC]/10',
    iconText: 'text-[#924CEC]',
    Icon: Briefcase,
  },
  {
    role: 'club',
    label: 'Join as Club',
    description: 'Discover talent and build your team',
    iconBg: 'bg-[#ec4899]/10',
    iconText: 'text-[#ec4899]',
    Icon: Building2,
  },
  {
    role: 'brand',
    label: 'Join as Brand',
    description: 'Showcase products and connect with athletes',
    iconBg: 'bg-[#f59e0b]/10',
    iconText: 'text-[#f59e0b]',
    Icon: Store,
  },
  {
    role: 'umpire',
    label: 'Join as Umpire',
    description: 'Be recognized as an officiating professional',
    iconBg: 'bg-[#A16207]/10',
    iconText: 'text-[#A16207]',
    Icon: Flag,
  },
]

export default function SignUp() {
  const navigate = useNavigate()
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null)

  // Once a role is selected, the AuthScreen takes over completely. No
  // parallel password form to manage here — that logic lives inside
  // AuthScreen along with OAuth, magic link, and progressive password
  // disclosure (the whole point of the redesign).
  if (selectedRole) {
    return (
      <AuthScreen
        mode="signup"
        role={selectedRole}
        onBack={() => setSelectedRole(null)}
      />
    )
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-gray-50 to-white flex flex-col">
      <InAppBrowserWarning context="signup" />

      <header className="pt-5 px-5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-gray-500 hover:text-gray-900 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Back</span>
        </button>
        <Link to="/" className="text-lg font-bold text-gray-900 tracking-tight">
          HOCKIA
        </Link>
        <div className="w-16" aria-hidden="true" />
      </header>

      <main className="flex-1 flex items-center justify-center px-5 py-6">
        <div className="w-full max-w-lg">
          <div className="text-center mb-7">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Join HOCKIA</h1>
            <p className="text-sm text-gray-600">Pick the role that fits you best to get started.</p>
          </div>

          <div className="space-y-3">
            {ROLE_CARDS.map(({ role, label, description, iconBg, iconText, Icon }) => (
              <button
                key={role}
                type="button"
                onClick={() => setSelectedRole(role)}
                className="w-full flex items-center gap-4 p-5 bg-white border border-gray-200 rounded-2xl hover:border-gray-300 hover:shadow-md transition-all text-left"
              >
                <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${iconBg}`}>
                  <Icon className={`w-6 h-6 ${iconText}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900">{label}</div>
                  <div className="text-sm text-gray-500 truncate">{description}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-7 pt-5 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{' '}
              <Link
                to="/signin"
                className="font-semibold text-[#8026FA] hover:text-[#6B20D4] transition-colors"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
