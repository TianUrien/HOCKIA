import { useEffect, useState } from 'react'
import {
  getAppVersion,
  getRuntimePlatform,
  getEnvironment,
  PLATFORM_LABEL,
  type AppVersionInfo,
} from '@/lib/appVersion'

const ENV_LABEL: Record<string, string> = {
  production: 'Production',
  staging: 'Staging',
  development: 'Development',
}

/**
 * Settings → About: shows the installed app version/build, what the app is
 * running as (iOS/Android native vs PWA vs browser), and the backend it points
 * at. Lets a user (or us, debugging) instantly confirm which build they're on —
 * e.g. whether they've actually updated to the version with the push fix.
 */
export default function AboutAppCard() {
  const [info, setInfo] = useState<AppVersionInfo | null>(null)
  const platform = getRuntimePlatform()
  const env = getEnvironment()
  const isNative = platform === 'ios-native' || platform === 'android-native'

  useEffect(() => {
    let cancelled = false
    getAppVersion().then((v) => { if (!cancelled) setInfo(v) })
    return () => { cancelled = true }
  }, [])

  const versionText = info
    ? `${info.version} (${info.build})`
    : isNative ? '—' : 'Web — always latest'

  const rows: [string, string][] = [
    ['Version', versionText],
    ['Platform', PLATFORM_LABEL[platform]],
    ['Environment', ENV_LABEL[env] ?? env],
  ]

  return (
    <dl className="divide-y divide-gray-100">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between py-2.5">
          <dt className="text-sm text-gray-500">{label}</dt>
          <dd className="text-sm font-medium text-gray-800">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
