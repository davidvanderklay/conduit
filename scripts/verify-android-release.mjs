import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

// Inspect the packaged APK, including TV metadata when the source enables TV.
export function verifyAndroidRelease(badging, { version, buildNumber, tv }) {
  const required = [
    ["application ID", "package: name='media.conduit.mobile'"],
    ["version name", `versionName='${version}'`],
    ["build number", `versionCode='${buildNumber}'`],
    ["phone launcher", "\nlaunchable-activity: name='media.conduit.mobile.MainActivity'"],
    ["universal native libraries", "native-code: 'arm64-v8a' 'x86_64'"],
  ]
  if (tv) {
    required.push(
      ["TV launcher", "leanback-launchable-activity: name='media.conduit.mobile.MainActivity'"],
      ["optional touchscreen", "uses-feature-not-required: name='android.hardware.touchscreen'"],
      ["optional Leanback support", "uses-feature-not-required: name='android.software.leanback'"],
    )
    if (!/^application:.* banner='[^']+'/m.test(badging))
      throw new Error("APK is missing its TV banner")
  }
  for (const [description, expected] of required) {
    if (!badging.includes(expected)) throw new Error(`APK has missing or incorrect ${description}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apk = process.argv[2]
  if (!apk) throw new Error("Usage: node scripts/verify-android-release.mjs <apk>")
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  const aapt = process.env.AAPT2 || (sdk && path.join(sdk, "build-tools/36.0.0/aapt2"))
  if (!aapt) throw new Error("Set ANDROID_HOME, ANDROID_SDK_ROOT, or AAPT2")
  const manifest = fs.readFileSync(
    process.env.ANDROID_MANIFEST ||
      new URL("../apps/mobile/composeApp/src/androidMain/AndroidManifest.xml", import.meta.url),
    "utf8",
  )
  verifyAndroidRelease(execFileSync(aapt, ["dump", "badging", apk], { encoding: "utf8" }), {
    version: process.env.CONDUIT_VERSION_NAME,
    buildNumber: process.env.CONDUIT_VERSION_CODE,
    tv: manifest.includes("android.intent.category.LEANBACK_LAUNCHER"),
  })
  console.log("Android APK identity, version, native libraries, and launcher metadata verified.")
}
