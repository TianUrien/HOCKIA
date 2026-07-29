import { Capacitor } from '@capacitor/core'

/**
 * Haptic feedback — native app only, and only where the OS itself would
 * haptic-confirm an equivalent interaction (tab switches, pull-to-refresh
 * completing). Deliberately NOT on every button: constant buzzing reads as
 * cheap, not premium. No-ops on web and on native builds that predate the
 * plugin (isPluginAvailable guard), so this ships safely ahead of the next
 * store build.
 */

const available = () =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Haptics')

export async function hapticSelection(): Promise<void> {
  if (!available()) return
  try {
    const { Haptics } = await import('@capacitor/haptics')
    await Haptics.selectionStart()
    await Haptics.selectionEnd()
  } catch { /* haptics are never worth an error */ }
}

export async function hapticLight(): Promise<void> {
  if (!available()) return
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch { /* noop */ }
}

export async function hapticSuccess(): Promise<void> {
  if (!available()) return
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics')
    await Haptics.notification({ type: NotificationType.Success })
  } catch { /* noop */ }
}
