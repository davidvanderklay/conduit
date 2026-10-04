import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const script = fileURLToPath(new URL("./publish-component-release.mjs", import.meta.url))

test("release notes use the component's previous release and include only its inputs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-release-notes-test-"))
  const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "pipe" })
  const commit = (file, message) => {
    const filename = path.join(directory, file)
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, message)
    git("add", ".")
    git("commit", "-m", message)
  }
  try {
    git("init")
    git("config", "user.name", "Release test")
    git("config", "user.email", "release-test@example.invalid")
    commit("apps/mobile/composeApp/src/androidMain/player.kt", "Initial shipped Android app")
    commit("apps/mobile/composeApp/src/androidMain/AndroidManifest.xml", "<manifest />")
    git("tag", "v0.1.4")
    commit("apps/mobile/composeApp/src/androidMain/player.kt", "Previous Android update")
    git("tag", "android/v0.2.0")
    commit("apps/mobile/composeApp/src/androidMain/player.kt", "Fix Android playback")
    commit("apps/mobile/composeApp/src/iosMain/player.kt", "Unrelated iOS fix")
    git("tag", "ios/v0.9.0")
    commit("packages/core/src/media.rs", "Fix shared engine")
    fs.writeFileSync(
      path.join(directory, "apps/mobile/composeApp/src/androidMain/AndroidManifest.xml"),
      '<manifest><category android:name="android.intent.category.LEANBACK_LAUNCHER" /></manifest>',
    )
    git("add", ".")
    git("commit", "-m", "Enable TV packaging")
    git("tag", "android/v0.2.1")

    const bin = path.join(directory, "bin")
    fs.mkdirSync(bin)
    // Refuse every mutation. The dry run should only read the releases API.
    fs.writeFileSync(
      path.join(bin, "gh"),
      `#!/usr/bin/env node\nif (process.argv[2] !== "api") process.exit(1)\nprocess.stdout.write(process.env.TEST_RELEASES)\n`,
      { mode: 0o755 },
    )
    const releases = [
      { tag_name: "v0.1.4", published_at: "2026-10-01T00:00:00Z" },
      { tag_name: "android/v0.2.0", published_at: "2026-10-02T00:00:00Z" },
      { tag_name: "ios/v0.9.0", published_at: "2026-10-03T00:00:00Z" },
    ]
    const preview = (previousReleases) =>
      execFileSync(process.execPath, [script, "--dry-run"], {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          COMPONENT: "android",
          RELEASE_TAG: "android/v0.2.1",
          GITHUB_REPOSITORY: "test/conduit",
          TEST_RELEASES: previousReleases.map((release) => JSON.stringify(release)).join("\n"),
        },
      })
    const notes = preview(releases)
    assert.match(notes, /Changes since `android\/v0.2.0`/)
    assert.match(notes, /Fix Android playback/)
    assert.match(notes, /Fix shared engine/)
    assert.match(notes, /One universal APK for Android phones, tablets, Android TV, and Google TV/)
    assert.match(notes, /television sign-in endpoints/)
    assert.doesNotMatch(notes, /Unrelated iOS fix|Previous Android update/)
    const firstRelease = preview(
      releases.filter((release) => !release.tag_name.startsWith("android/")),
    )
    assert.match(firstRelease, /Changes since `v0.1.4`/)
    assert.match(firstRelease, /Previous Android update/)
    assert.doesNotMatch(firstRelease, /Unrelated iOS fix/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
