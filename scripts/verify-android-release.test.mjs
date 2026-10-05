import assert from "node:assert/strict"
import test from "node:test"
import { verifyAndroidRelease } from "./verify-android-release.mjs"

const metadata = `package: name='media.conduit.mobile' versionCode='1000001' versionName='0.2.0-alpha.1'
application: label='conduit' banner='res/drawable-xhdpi-v4/tv_banner.png'
launchable-activity: name='media.conduit.mobile.MainActivity'
leanback-launchable-activity: name='media.conduit.mobile.MainActivity'
uses-feature-not-required: name='android.hardware.touchscreen'
uses-feature-not-required: name='android.software.leanback'
native-code: 'arm64-v8a' 'armeabi-v7a' 'x86_64'
`
const release = { version: "0.2.0-alpha.1", buildNumber: "1000001", tv: true }

test("one Android APK retains both phone and TV launchers and every native ABI", () => {
  verifyAndroidRelease(metadata, release)
  assert.throws(
    () => verifyAndroidRelease(metadata, { ...release, version: "0.2.0" }),
    /version name/,
  )
  assert.throws(
    () => verifyAndroidRelease(metadata, { ...release, buildNumber: "1" }),
    /build number/,
  )
  assert.throws(
    () => verifyAndroidRelease(metadata.replace(" 'x86_64'", ""), release),
    /native libraries/,
  )
})

test("TV-enabled releases reject missing TV packaging while pre-TV builds remain supported", () => {
  for (const entry of [
    "leanback-launchable-activity: name='media.conduit.mobile.MainActivity'",
    "uses-feature-not-required: name='android.hardware.touchscreen'",
    "uses-feature-not-required: name='android.software.leanback'",
    " banner='res/drawable-xhdpi-v4/tv_banner.png'",
  ]) {
    const missingEntry = metadata.replace(entry, "")
    assert.throws(() => verifyAndroidRelease(missingEntry, release))
    verifyAndroidRelease(missingEntry, { ...release, tv: false })
  }
})
