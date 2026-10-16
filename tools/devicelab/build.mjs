#!/usr/bin/env node
/**
 * Builds what the lab drives: the web bundle pointed at STAGING (vite
 * `--mode lab` reads client/.env, never .env.production), synced into the
 * native projects, then the iOS simulator app (unsigned Debug) and the
 * Android debug APK. Never produces a store build.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { CLIENT_DIR, BUILD_DIR, IOS_APP, ANDROID_APK, JAVA_HOME, ANDROID_SDK, WDA_DERIVED, WDA_RUNNER } from './lib/config.mjs'

// HOCKIA_LAB=1 makes capacitor.config.ts mark the iOS WebView inspectable (lab builds only).
const run = (cmd, cwd = CLIENT_DIR) => { console.log(`\n$ ${cmd}`); execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, JAVA_HOME, ANDROID_HOME: ANDROID_SDK, HOCKIA_LAB: '1' } }) }
const only = process.argv.includes('--ios') ? 'ios' : process.argv.includes('--android') ? 'android' : 'all'

run('npx vite build --mode lab')
// The native shell wants the plain SPA shell as index.html (the prerendered
// landing is a web-only artefact); vite --mode lab skips the postbuild, so
// dist/index.html already IS the shell.
if (only !== 'android') run('npx cap sync ios')
if (only !== 'ios') run('npx cap sync android')
if (only !== 'android') {
  fs.mkdirSync(path.join(BUILD_DIR, 'ios'), { recursive: true })
  run(`xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "${path.join(BUILD_DIR, 'ios')}" CODE_SIGNING_ALLOWED=NO build | grep -E "BUILD SUCCEEDED|BUILD FAILED|error:" || true`)
  if (!fs.existsSync(IOS_APP)) throw new Error('iOS simulator app not built')
  console.log('iOS app:', IOS_APP)
  // WebDriverAgent, once: the project ships with IPHONEOS_DEPLOYMENT_TARGET
  // 12.0, which Xcode 27 refuses; override it. Skipped when already built.
  if (!fs.existsSync(WDA_RUNNER) || process.argv.includes('--wda')) {
    const wda = path.join(path.dirname(new URL(import.meta.url).pathname), 'node_modules', 'appium-xcuitest-driver', 'node_modules', 'appium-webdriveragent', 'WebDriverAgent.xcodeproj')
    run(`xcodebuild -project "${wda}" -scheme WebDriverAgentRunner -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "${WDA_DERIVED}" CODE_SIGNING_ALLOWED=NO IPHONEOS_DEPLOYMENT_TARGET=16.0 build-for-testing | grep -E "BUILD SUCCEEDED|BUILD FAILED|error:" || true`)
    if (!fs.existsSync(WDA_RUNNER)) throw new Error('WebDriverAgent not built')
  }
  console.log('WebDriverAgent:', WDA_RUNNER)
}
if (only !== 'ios') {
  run('./gradlew assembleDebug -q', path.join(CLIENT_DIR, 'android'))
  if (!fs.existsSync(ANDROID_APK)) throw new Error('Android APK not built')
  console.log('Android APK:', ANDROID_APK)
}
