import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseReleaseTag } from "./release-context.mjs"

const { component, version, tag, prerelease } = parseReleaseTag(
  process.env.RELEASE_TAG,
  process.env.COMPONENT,
)
const repository = process.env.GITHUB_REPOSITORY
if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("Invalid GITHUB_REPOSITORY")
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim()
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
const allReleases = gh(
  "api",
  "--paginate",
  `repos/${repository}/releases?per_page=100`,
  "--jq",
  ".[] | {tag_name, draft, published_at}",
)
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const releases = allReleases.filter((release) => !release.draft && release.tag_name !== tag)
const ancestors = new Set(git("tag", "--merged", "HEAD").split("\n"))
const prior = releases
  .filter(
    (release) => ancestors.has(release.tag_name) && release.tag_name.startsWith(`${component}/v`),
  )
  .sort((a, b) => b.published_at.localeCompare(a.published_at))[0]
// First component release starts at the last shipped legacy release, not another component's tag.
const legacy = releases
  .filter((release) => ancestors.has(release.tag_name) && /^v[0-9]/.test(release.tag_name))
  .sort((a, b) => b.published_at.localeCompare(a.published_at))[0]
const previousTag = prior?.tag_name ?? legacy?.tag_name
const inputs = {
  server: [
    "apps/server",
    "Dockerfile",
    "docker",
    "compose.yaml",
    ".env.docker.example",
    "pnpm-lock.yaml",
  ],
  web: ["apps/web", "packages/core", "Dockerfile", "docker", "pnpm-lock.yaml", "Cargo.lock"],
  desktop: ["apps/desktop", "apps/web", "packages/core", "flatpak", "pnpm-lock.yaml", "Cargo.lock"],
  android: [
    "apps/mobile/composeApp/src/commonMain",
    "apps/mobile/composeApp/src/androidMain",
    "apps/mobile/composeApp/build.gradle.kts",
    "apps/mobile/build.gradle.kts",
    "apps/mobile/settings.gradle.kts",
    "apps/mobile/gradle.properties",
    "apps/mobile/gradle",
    "apps/mobile/scripts/build-rust-android.sh",
    "scripts/verify-android-release.mjs",
    "packages/core",
    "packages/mobile-bridge",
    "Cargo.lock",
  ],
  ios: [
    "apps/mobile/composeApp/src/commonMain",
    "apps/mobile/composeApp/src/iosMain",
    "apps/mobile/iosApp",
    "apps/mobile/composeApp/build.gradle.kts",
    "apps/mobile/build.gradle.kts",
    "apps/mobile/settings.gradle.kts",
    "apps/mobile/gradle.properties",
    "apps/mobile/gradle",
    "apps/mobile/scripts/build-rust-ios.sh",
    "apps/mobile/scripts/package-ios-ipa.sh",
    "packages/core",
    "packages/mobile-bridge",
    "Cargo.lock",
  ],
}
const sharedInputs = [
  "package.json",
  "pnpm-workspace.yaml",
  "vite.config.ts",
  "Cargo.toml",
  "scripts/release-context.mjs",
  "scripts/publish-component-release.mjs",
  "scripts/upload-release-assets.sh",
  ".github/workflows/release-context.yml",
]
const workflow =
  component === "server" || component === "web"
    ? ".github/workflows/container-release.yml"
    : component === "desktop"
      ? ".github/workflows/release.yml"
      : `.github/workflows/release-${component}.yml`
const changes = git(
  "log",
  "--format=- %s (%h)",
  previousTag ? `${previousTag}..HEAD` : "HEAD",
  "--",
  ...inputs[component],
  ...sharedInputs,
  workflow,
)
let notes = `## ${component} ${version}\n\n${changes || "Packaging release with no component source changes."}\n`
if (
  component === "android" &&
  fs
    .readFileSync("apps/mobile/composeApp/src/androidMain/AndroidManifest.xml", "utf8")
    .includes("android.intent.category.LEANBACK_LAUNCHER")
) {
  notes +=
    "\nOne universal APK for Android phones, tablets, Android TV, and Google TV. TV phone pairing requires a server with the television sign-in endpoints.\n"
}
if (previousTag) notes += `\nChanges since \`${previousTag}\`.\n`
if (process.env.COUNTERPART_COMPONENT && process.env.COUNTERPART_VERSION) {
  notes += `\nTested with ${process.env.COUNTERPART_COMPONENT} image \`${process.env.COUNTERPART_VERSION}\`. Use the attached environment template for this pair.\n`
}
if (process.argv.includes("--dry-run")) {
  process.stdout.write(notes)
  process.exit(0)
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-release-"))
try {
  const notesPath = path.join(directory, "notes.md")
  fs.writeFileSync(notesPath, notes)
  const title = `Conduit ${component} ${version}`
  const current = allReleases.find((release) => release.tag_name === tag)
  if (current) {
    gh(
      "release",
      "edit",
      tag,
      "--repo",
      repository,
      "--title",
      title,
      "--notes-file",
      notesPath,
      "--latest=false",
      `--prerelease=${prerelease}`,
    )
  } else {
    gh(
      "release",
      "create",
      tag,
      "--repo",
      repository,
      "--verify-tag",
      "--title",
      title,
      "--notes-file",
      notesPath,
      "--latest=false",
      ...(prerelease ? ["--prerelease"] : []),
    )
  }
} finally {
  fs.rmSync(directory, { recursive: true, force: true })
}
