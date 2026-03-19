import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Menu, X, Globe, Users, Briefcase, LogIn, UserPlus } from 'lucide-react'

interface PublicNavProps {
  /** Whether to use transparent background (for hero sections) */
  transparent?: boolean
}

/**
 * PublicNav - Marketing navigation for unauthenticated users
 * 
 * Shows links to public routes:
 * - Community (public Q&A)
 * - Opportunities (public vacancy listings)  
 * - World (country → league → club directory)
 * - Sign In
 * - Join Now
 */
export default function PublicNav({ transparent = true }: PublicNavProps) {
  const navigate = useNavigate()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const navLinks = [
    { href: '/world', label: 'Hockey World', icon: Globe },
    { href: '/opportunities', label: 'Opportunities', icon: Briefcase },
    { href: '/community', label: 'Community', icon: Users },
  ]

  return (
    <nav 
      className={`relative z-20 w-full ${
        transparent 
          ? 'bg-transparent' 
          : 'bg-white/95 backdrop-blur-sm border-b border-gray-200'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-10 lg:h-20 lg:justify-center lg:relative">
          {/* Logo - Mobile only (desktop shows hero logo instead) */}
          <Link to="/" className="flex-shrink-0 lg:hidden">
            <img 
              src={transparent ? '/WhiteLogo.svg' : '/HockiaLogoBlack.svg'}
              alt="HOCKIA"
              className="h-8"
            />
          </Link>

          {/* Desktop Navigation - centered */}
          <div className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => {
              const Icon = link.icon
              return (
                <Link
                  key={link.href}
                  to={link.href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    transparent
                      ? 'text-white/90 hover:text-white hover:bg-white/10'
                      : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Link>
              )
            })}
          </div>

          {/* Desktop Auth Buttons - positioned right */}
          <div className="hidden lg:flex lg:absolute lg:right-0 items-center gap-3">
            <button
              onClick={() => {
                // Scroll to sign-in form on landing page
                const signInCard = document.querySelector('[data-signin-card]')
                if (signInCard) {
                  signInCard.scrollIntoView({ behavior: 'smooth', block: 'center' })
                } else {
                  navigate('/')
                }
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                transparent
                  ? 'text-white/90 hover:text-white hover:bg-white/10'
                  : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <LogIn className="w-4 h-4" />
              Sign In
            </button>
            <Link
              to="/signup"
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity shadow-lg"
            >
              <UserPlus className="w-4 h-4" />
              Join Now
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className={`lg:hidden p-2 rounded-lg transition-colors ${
              transparent
                ? 'text-white hover:bg-white/10'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
            aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
          >
            {isMobileMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className={`lg:hidden py-4 border-t ${
            transparent ? 'border-white/20' : 'border-gray-200'
          }`}>
            <div className="flex flex-col gap-1">
              {navLinks.map((link) => {
                const Icon = link.icon
                return (
                  <Link
                    key={link.href}
                    to={link.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors ${
                      transparent
                        ? 'text-white/90 hover:text-white hover:bg-white/10'
                        : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {link.label}
                  </Link>
                )
              })}
              
              <div className={`my-2 border-t ${transparent ? 'border-white/20' : 'border-gray-200'}`} />
              
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false)
                  const signInCard = document.querySelector('[data-signin-card]')
                  if (signInCard) {
                    signInCard.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                }}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors ${
                  transparent
                    ? 'text-white/90 hover:text-white hover:bg-white/10'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <LogIn className="w-5 h-5" />
                Sign In
              </button>
              
              <Link
                to="/signup"
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center justify-center gap-2 mx-4 mt-2 px-5 py-3 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-base font-semibold rounded-lg hover:opacity-90 transition-opacity shadow-lg"
              >
                <UserPlus className="w-5 h-5" />
                Join Now
              </Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
