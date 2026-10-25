import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(new URL("./publish-nightly-tags.mjs", import.meta.url))
const nightlyVersions = fileURLToPath(new URL("../releases/nightly-versions.json", import.meta.url))
const versions = JSON.parse(fs.readFileSync(nightlyVersions, "utf8"))

for (const { name, changed, unpublished, expected } of [
  { name: "unchanged mobile releases", expected: [] },
  {
    name: "Android source changes",
    changed: "apps/mobile/composeApp/src/androidMain/Changed.kt",
    expected: ["android"],
  },
  {
    name: "iOS source changes",
    changed: "apps/mobile/iosApp/Changed.swift",
    expected: ["ios"],
  },
  {
    name: "shared mobile source changes",
    changed: "apps/mobile/composeApp/src/commonMain/Changed.kt",
    expected: ["android", "ios"],
  },
  {
    name: "P2P dependency changes",
    changed: "packages/p2p/src/lib.rs",
    expected: ["android", "ios"],
  },
  {
    name: "shared P2P source changes",
    changed: "apps/mobile/composeApp/src/p2pEnabled/Changed.kt",
    expected: ["android", "ios"],
  },
  {
    name: "Android icon changes",
    changed: "apps/desktop/icons/android/values/ic_launcher_background.xml",
    expected: ["android", "desktop"],
  },
  { name: "unpublished Android release", unpublished: "android", expected: ["android"] },
  { name: "unpublished iOS release", unpublished: "ios", expected: ["ios"] },
]) {
  test(`nightly tags select ${name}`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-mobile-nightly-test-"))
    const git = (...args) =>
      execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: "pipe" }).trim()
    try {
      git("init")
      git("config", "user.name", "Test")
      git("config", "user.email", "test@example.com")
      fs.mkdirSync(path.join(directory, "releases"))
      fs.copyFileSync(nightlyVersions, path.join(directory, "releases/nightly-versions.json"))
      git("add", ".")
      git("commit", "-m", "Published revision")
      const previous = git("rev-parse", "HEAD")
      if (changed) {
        const target = path.join(directory, changed)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, "changed\n")
        git("add", ".")
        git("commit", "-m", "Component change")
      }
      git("init", "--bare", "remote.git")
      git("remote", "add", "origin", path.join(directory, "remote.git"))
      const bin = path.join(directory, "bin")
      fs.mkdirSync(bin)
      fs.writeFileSync(
        path.join(bin, "gh"),
        `#!${process.execPath}
if (process.env.TEST_UNPUBLISHED && process.argv.some(arg => arg.includes(process.env.TEST_UNPUBLISHED + "/nightly/"))) {
  console.error("HTTP 404"); process.exit(1)
}
console.log(Buffer.from(JSON.stringify({commit: process.env.TEST_PREVIOUS})).toString("base64"))
`,
        { mode: 0o755 },
      )
      execFileSync(process.execPath, [script], {
        cwd: directory,
        stdio: "pipe",
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          GITHUB_RUN_NUMBER: "123",
          TEST_PREVIOUS: previous,
          TEST_UNPUBLISHED: unpublished ?? "",
        },
      })
      const tags = git("--git-dir=remote.git", "tag", "--list").split("\n").filter(Boolean)
      assert.deepEqual(tags.map((tag) => tag.split("/")[0]).sort(), [...expected].sort())
      for (const tag of tags) {
        const [component, version] = tag.split("/v")
        assert.match(version, new RegExp(`^${versions[component].replaceAll(".", "\\.")}-nightly\\.\\d{8}\\.123$`))
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}

test("unchanged published components are skipped but a failed unpublished nightly gets retried", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-nightly-test-"))
  try {
    fs.mkdirSync(path.join(directory, "releases"))
    fs.writeFileSync(
      path.join(directory, "releases/nightly-versions.json"),
      JSON.stringify({ server: "1.1.0", web: "1.1.0", desktop: "1.1.0" }),
    )
    const bin = path.join(directory, "bin")
    fs.mkdirSync(bin)
    fs.writeFileSync(
      path.join(bin, "git"),
      `#!${process.execPath}
const fs = require("node:fs")
const args = process.argv.slice(2)
if (args[0] === "tag" && args[1] === "--list") console.log(args[2].replace("*", "1.0.0-nightly.20260101.1"))
else if (args[0] === "diff") console.log(args.includes("apps/server") ? "" : "apps/web/src/app.tsx")
else if (args[0] === "push") fs.appendFileSync(process.env.TEST_PUSHES, args[2] + "\\n")
`,
      { mode: 0o755 },
    )
    fs.writeFileSync(
      path.join(bin, "gh"),
      `#!${process.execPath}
if (process.argv.some(arg => arg.includes("web/nightly"))) { console.error("HTTP 404"); process.exit(1) }
console.log(Buffer.from(JSON.stringify({commit:"a".repeat(40)})).toString("base64"))
`,
      { mode: 0o755 },
    )
    const pushes = path.join(directory, "pushes.txt")
    execFileSync(process.execPath, [script], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        GITHUB_RUN_NUMBER: "123",
        TEST_PUSHES: pushes,
      },
    })
    const tags = fs.readFileSync(pushes, "utf8")
    assert.doesNotMatch(tags, /server\/v/)
    assert.match(tags, /web\/v1\.1\.0-nightly\.\d{8}\.123/)
    assert.match(tags, /desktop\/v1\.1\.0-nightly\.\d{8}\.123/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
