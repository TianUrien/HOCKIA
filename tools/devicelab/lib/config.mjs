import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export const LAB_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const REPO_DIR = path.resolve(LAB_DIR, '..', '..')
export const CLIENT_DIR = path.join(REPO_DIR, 'client')
export const BUILD_DIR = path.join(LAB_DIR, '.build')
export const IOS_APP = path.join(BUILD_DIR, 'ios', 'Build', 'Products', 'Debug-iphonesimulator', 'App.app')
/** WebDriverAgent built once by build.mjs with a deployment target Xcode 27 accepts (the shipped project says iOS 12 and fails to build). */
export const WDA_DERIVED = path.join(BUILD_DIR, 'wda')
export const WDA_RUNNER = path.join(WDA_DERIVED, 'Build', 'Products', 'Debug-iphonesimulator', 'WebDriverAgentRunner-Runner.app')
export const ANDROID_APK = path.join(CLIENT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
export const ANDROID_SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'Library', 'Android', 'sdk')
export const JAVA_HOME = process.env.JAVA_HOME || '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
export const APP_ID = 'com.inhockia.app'
/** The web the native app serves itself from (capacitor.config hostname). */
export const APP_ORIGIN = 'https://app.inhockia.com'
/** Web target for desktop devices; the lab build points the app at staging too. */
export const WEB_BASE = process.env.LAB_WEB_BASE || 'https://staging.inhockia.com'
export const APPIUM_PORT = Number(process.env.APPIUM_PORT || 4723)

/** Dotenv-style parser: KEY=value lines, quotes stripped, comments ignored. */
export function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {}
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
}

/** Staging QA account (never printed, never committed). */
export function qaCredentials() {
  const env = parseEnvFile(path.join(os.homedir(), '.config', 'hockia', 'staging-qa.env'))
  if (!env.QA_EMAIL || !env.QA_PASSWORD) throw new Error('QA_EMAIL / QA_PASSWORD missing in ~/.config/hockia/staging-qa.env')
  return { email: env.QA_EMAIL, password: env.QA_PASSWORD }
}

export function loadDevices(filter) {
  const all = JSON.parse(fs.readFileSync(path.join(LAB_DIR, 'devices.json'), 'utf8')).devices
  if (!filter || filter === 'all') return all
  const wanted = new Set(filter.split(','))
  const picked = all.filter((d) => wanted.has(d.id) || wanted.has(d.platform) || wanted.has(d.kind))
  if (!picked.length) throw new Error(`No device matches "${filter}". Known: ${all.map((d) => d.id).join(', ')}`)
  return picked
}
