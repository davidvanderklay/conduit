import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { stringify, parse } from "yaml"
import { writeFeeds, desktopMetadata } from "./publish-update-feed.mjs"

const release = (component, version) => ({
  tag_name: `${component}/v${version}`,
  version,
  draft: false,
  prerelease: version.includes("-"),
  commit: "a".repeat(40),
  published_at: "2026-10-04T00:00:00Z",
  assets: [],
})
test("component feeds stay isolated, never move backward, and stable can supersede nightly", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-feed-test-"))
  try {
    writeFeeds(release("server", "1.0.0"), "server", directory)
    writeFeeds(release("web", "5.0.0"), "web", directory)
    writeFeeds(release("server", "1.1.0-nightly.20261004.1"), "server", directory)
    const read = (component, track) =>
      JSON.parse(fs.readFileSync(path.join(directory, component, track, "updates.json"), "utf8"))
    assert.equal(read("server", "stable").version, "1.0.0")
    assert.equal(read("server", "nightly").version, "1.1.0-nightly.20261004.1")
    writeFeeds(release("server", "1.0.1"), "server", directory)
    assert.equal(read("server", "nightly").version, "1.1.0-nightly.20261004.1")
    writeFeeds(release("server", "1.1.0"), "server", directory)
    assert.equal(read("server", "nightly").version, "1.1.0")
    writeFeeds(release("server", "1.0.0"), "server", directory)
    assert.equal(read("server", "stable").version, "1.1.0")
    assert.equal(read("web", "stable").version, "5.0.0")
    assert.throws(() =>
      writeFeeds({ ...release("server", "1.2.0"), draft: true }, "server", directory),
    )
    assert.throws(() => writeFeeds(release("server", "1.2.0-alpha.1"), "server", directory))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
test("desktop publication requires Windows and both Mac ZIPs and retains architecture-specific URLs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-metadata-test-"))
  try {
    const candidate = release("desktop", "1.0.0")
    for (const [name, payload] of [
      ["latest.yml", "conduit-1.0.0-windows-x64.exe"],
      ["latest-mac-arm64.yml", "conduit-1.0.0-macos-arm64.zip"],
      ["latest-mac-x64.yml", "conduit-1.0.0-macos-x64.zip"],
    ]) {
      candidate.assets.push({
        name: payload,
        browser_download_url: `https://github.com/davidvanderklay/conduit/releases/download/desktop%2Fv1.0.0/${payload}`,
      })
      fs.writeFileSync(
        path.join(directory, name),
        stringify({
          version: "1.0.0",
          files: [{ url: payload, sha512: Buffer.alloc(64).toString("base64"), size: 123 }],
        }),
      )
    }
    const result = desktopMetadata(candidate, directory)
    assert.equal(result.mac.files.length, 2)
    writeFeeds(candidate, "desktop", path.join(directory, "feeds"), directory)
    const yaml = parse(
      fs.readFileSync(path.join(directory, "feeds/desktop/nightly/nightly-mac.yml"), "utf8"),
    )
    assert.equal(yaml.files.length, 2)
    fs.unlinkSync(path.join(directory, "latest-mac-x64.yml"))
    assert.throws(() => desktopMetadata(candidate, directory), /Both Mac ZIPs/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
