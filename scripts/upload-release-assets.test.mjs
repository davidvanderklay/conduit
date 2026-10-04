import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

function uploadFixture(t, existing = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-upload-test-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  for (const [name, source] of Object.entries({
    gh: `#!/usr/bin/env bash
set -eu
case "$*" in
  *'releases?per_page=100'*)
    if [ -f "$FIXTURE_DIR/listed" ]; then echo 42; else touch "$FIXTURE_DIR/listed"; fi ;;
  *'releases/42/assets?'*) ${existing ? "echo 99" : ":"} ;;
  *'releases/42'*) echo 'https://uploads.github.com/repos/test/repo/releases/42/assets{?name,label}' ;;
  *) exit 1 ;;
esac
`,
    curl: '#!/usr/bin/env bash\ntouch "$FIXTURE_DIR/uploaded"\n',
    sleep: "#!/usr/bin/env bash\nexit 0\n",
  })) {
    fs.writeFileSync(path.join(directory, name), source, { mode: 0o755 })
  }
  const asset = path.join(directory, "installer.exe")
  fs.writeFileSync(asset, "installer")
  return {
    directory,
    run: () =>
      spawnSync("bash", ["scripts/upload-release-assets.sh", "desktop/v1.0.0", asset], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env.PATH}`,
          FIXTURE_DIR: directory,
          GH_TOKEN: "fixture-token",
          GITHUB_REPOSITORY: "test/repo",
        },
      }),
  }
}

test("upload waits for a newly created draft to appear in GitHub's listing", (t) => {
  const fixture = uploadFixture(t)
  const result = fixture.run()
  assert.equal(result.status, 0, result.stderr)
  assert.ok(fs.existsSync(path.join(fixture.directory, "uploaded")))
})

test("upload preserves existing release assets after the draft becomes visible", (t) => {
  const fixture = uploadFixture(t, true)
  const result = fixture.run()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Release assets are immutable/)
  assert.ok(!fs.existsSync(path.join(fixture.directory, "uploaded")))
})
