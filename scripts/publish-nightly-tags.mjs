import fs from "node:fs"
import { execFileSync } from "node:child_process"
import { valid, gt, rcompare } from "semver"

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
const versions = JSON.parse(fs.readFileSync("releases/nightly-versions.json", "utf8"))
const inputs = {
  server: [
    "apps/server",
    "packages/updates",
    "Dockerfile",
    "docker",
    "compose.yaml",
    "releases/container-pair.json",
  ],
  web: ["apps/web", "packages/core", "packages/updates", "Dockerfile", "docker"],
  desktop: ["apps/desktop", "apps/web", "packages/core", "packages/updates", "flatpak"],
}
const date = new Date().toISOString().slice(0, 10).replaceAll("-", "")
const run = process.env.GITHUB_RUN_NUMBER
if (!/^[1-9][0-9]*$/.test(run ?? "")) throw new Error("Invalid nightly build number")
for (const [component, base] of Object.entries(versions)) {
  if (!valid(base) || base.includes("-") || !inputs[component])
    throw new Error("Invalid nightly base version")
  const tags = git("tag", "--list", `${component}/v*`)
    .split("\n")
    .filter(Boolean)
    .map((tag) => ({ tag, version: tag.slice(`${component}/v`.length) }))
    .filter(({ version }) => valid(version))
    .sort((a, b) => rcompare(a.version, b.version))
  let previous
  try {
    const content = execFileSync(
      "gh",
      [
        "api",
        `repos/davidvanderklay/conduit/contents/${component}/nightly/updates.json?ref=update-feeds`,
        "--jq",
        ".content",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
    previous = JSON.parse(Buffer.from(content.trim(), "base64").toString("utf8")).commit
    if (!/^[a-f0-9]{40}$/.test(previous)) throw new Error("Invalid published Nightly revision")
  } catch (error) {
    if (!String(error.stderr).includes("404")) throw error
    // No feed yet. Build the component instead of treating an unpublished tag as success.
  }
  const version = `${base}-nightly.${date}.${run}`
  if (tags[0] && !gt(version, tags[0].version))
    throw new Error(`Advance releases/nightly-versions.json for ${component}`)
  if (
    previous &&
    !git(
      "diff",
      "--name-only",
      previous,
      "HEAD",
      "--",
      ...inputs[component],
      "pnpm-lock.yaml",
      "scripts",
      ".github/workflows",
      "package.json",
      "releases/nightly-versions.json",
    )
  )
    continue
  const tag = `${component}/v${version}`
  git("tag", tag)
  git("push", "origin", `refs/tags/${tag}`)
  process.stdout.write(`Queued ${tag}\n`)
}
