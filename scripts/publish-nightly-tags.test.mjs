import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(new URL("./publish-nightly-tags.mjs", import.meta.url))
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
