import { getRuntimePlatform } from '@/lib/appVersion'

/**
 * Switch track colour (founder 2026-10-25, rebrand): violet when on, on the
 * web and in the Android app (Figma Android / Switch 128:237); the iPhone app
 * keeps the system switch green (#34C759, UISwitch's on tint). Off is the
 * border/default track everywhere. Decided once per page load, like the
 * platform chrome.
 */
const IOS_NATIVE = getRuntimePlatform() === 'ios-native'

export function switchTrackClass(on: boolean): string {
  return on ? (IOS_NATIVE ? 'bg-[#34c759]' : 'bg-brand-primary') : 'bg-line'
}
