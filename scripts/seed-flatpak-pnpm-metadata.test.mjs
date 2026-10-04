import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

test("Flatpak can deploy desktop production dependencies with an empty offline metadata cache", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-flatpak-deploy-test-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const env = { ...process.env, XDG_CACHE_HOME: path.join(directory, "cache") }
  execFileSync(process.execPath, ["scripts/seed-flatpak-pnpm-metadata.mjs"], { env })
  const target = path.join(directory, "runtime")
  execFileSync(
    "pnpm",
    ["--filter", "@conduit/desktop", "deploy", "--prod", "--legacy", "--offline", target],
    { env, stdio: "pipe" },
  )
  const source = JSON.parse(fs.readFileSync("apps/desktop/package.json", "utf8"))
  const deployed = JSON.parse(
    fs.readFileSync(path.join(target, "node_modules/electron-updater/package.json"), "utf8"),
  )
  assert.equal(deployed.version, source.dependencies["electron-updater"])
  assert.ok(fs.existsSync(path.join(target, "node_modules/@conduit/updates/package.json")))
})
