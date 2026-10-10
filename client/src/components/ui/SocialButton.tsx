import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ComponentType } from 'react'
import { cn } from '@/lib/utils'

/**
 * Button / Social (Figma 535:8381): "Continue with Apple" / "Continue with
 * Google". Large 48, full width, radius 12, label 16 semibold. Apple is the
 * inverse surface with a white logo; Google is white with the default line
 * border and the four-colour logo. Apple sits first per HIG wherever both
 * appear (First run 104:2096, Log in 114:477). Facebook (founder ruling
 * 2026-10-10: third, everywhere; Figma Provider=Facebook 613:68, web
 * "Social / Facebook" 153:455…470) follows Meta's brand rule — social-facebook fill,
 * white "f" logo, "Continue with Facebook".
 */
export type SocialProvider = 'apple' | 'google' | 'facebook'

export interface SocialButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  provider: SocialProvider
  /** 'web' = the Landing v3 auth cut (Figma 127:2141): Large 52 pill, 17
   *  semibold; Google with the 1.5 px line-strong border. Default 'app'. */
  appearance?: 'app' | 'web'
}

const PROVIDER_STYLES: Record<SocialProvider, string> = {
  apple: 'bg-surface-inverse text-white active:opacity-90',
  google: 'bg-white text-ink-1 ring-1 ring-inset ring-line active:bg-surface-muted',
  facebook: 'bg-social-facebook text-white active:bg-[#145DBF]',
}

const WEB_PROVIDER_STYLES: Record<SocialProvider, string> = {
  apple: 'bg-surface-inverse text-white hover:bg-[#26262e] active:opacity-90',
  google: 'border-[1.5px] border-line-strong bg-white text-ink-1 hover:bg-surface-subtle active:bg-surface-muted',
  facebook: 'bg-social-facebook text-white hover:bg-[#166FE5] active:bg-[#145DBF]',
}

function AppleLogo() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  )
}

function GoogleLogo() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function FacebookLogo() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
    </svg>
  )
}

const LOGOS: Record<SocialProvider, ComponentType> = { apple: AppleLogo, google: GoogleLogo, facebook: FacebookLogo }

export const SocialButton = forwardRef<HTMLButtonElement, SocialButtonProps>(function SocialButton(
  { provider, appearance = 'app', className, children, type = 'button', ...rest },
  ref,
) {
  const web = appearance === 'web'
  const Logo = LOGOS[provider]
  return (
    <button
      ref={ref}
      type={type}
      data-provider={provider}
      data-appearance={appearance}
      className={cn(
        'flex w-full shrink-0 select-none items-center justify-center gap-2.5 font-semibold transition-colors focus:outline-none disabled:opacity-40',
        web
          ? 'h-[52px] rounded-full text-[17px] leading-[22px] duration-[160ms] focus-visible:ring-4 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white'
          : 'h-12 rounded-[12px] text-[16px] leading-[22px] focus-visible:ring-2 focus-visible:ring-hockia-primary/40',
        web ? WEB_PROVIDER_STYLES[provider] : PROVIDER_STYLES[provider],
        className,
      )}
      {...rest}
    >
      <Logo />
      <span>{children}</span>
    </button>
  )
})
