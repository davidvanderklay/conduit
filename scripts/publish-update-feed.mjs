import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { gt } from "semver"
import { parse, stringify } from "yaml"
import { parseReleaseTag } from "./release-context.mjs"

/** Build installer metadata from the uploaded release, preserving both Mac architectures. */
export function desktopMetadata(release, directory) {
  const documents = fs
    .readdirSync(directory)
    .filter((name) => /^(latest|nightly)(-mac)?(?:-(arm64|x64))?\.yml$/.test(name))
    .map((name) => ({ name, value: parse(fs.readFileSync(path.join(directory, name), "utf8")) }))
  const metadata = (mac) => {
    const inputs = documents.filter(({ name }) => name.includes("-mac") === mac)
    if (!inputs.length) throw new Error(`Missing ${mac ? "Mac" : "Windows"} updater metadata`)
    const files = inputs.flatMap(({ value }) => {
      if (value.version !== release.version || !Array.isArray(value.files))
        throw new Error("Updater metadata version mismatch")
      return value.files.map((file) => {
        const asset = release.assets.find((asset) => asset.name === file.url)
        if (
          !asset ||
          !asset.browser_download_url ||
          !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512 ?? "") ||
          !Number.isSafeInteger(file.size) ||
          file.size <= 0
        )
          throw new Error("Missing or invalid updater payload")
        return { url: asset.browser_download_url, sha512: file.sha512, size: file.size }
      })
    })
    if (!mac && !files.some((file) => file.url.endsWith(".exe")))
      throw new Error("Missing Windows installer")
    if (
      mac &&
      !["arm64", "x64"].every((arch) =>
        files.some((file) => file.url.endsWith(`-macos-${arch}.zip`)),
      )
    )
      throw new Error("Both Mac ZIPs are required")
    return {
      version: release.version,
      files,
      path: files[0].url,
      sha512: files[0].sha512,
      releaseDate: release.published_at,
    }
  }
  return { windows: metadata(false), mac: metadata(true) }
}

/** A release changes only its component feeds. Stable also advances Nightly when newer. */
export function writeFeeds(release, component, directory, artifactDirectory) {
  const parsed = parseReleaseTag(release.tag_name, component)
  if (release.draft || parsed.prerelease !== release.prerelease)
    throw new Error("Release must be public with the correct prerelease flag")
  if (parsed.prerelease && !parsed.version.includes("-nightly."))
    throw new Error("Only nightly prereleases enter the Nightly feed")
  if (!/^[a-f0-9]{40}$/.test(release.commit)) throw new Error("Invalid release revision")
  release = { ...release, version: parsed.version }
  const metadata = component === "desktop" ? desktopMetadata(release, artifactDirectory) : undefined
  const tracks = parsed.prerelease ? ["nightly"] : ["stable", "nightly"]
  for (const track of tracks) {
    const target = path.join(directory, component, track)
    const summaryPath = path.join(target, "updates.json")
    const prior = fs.existsSync(summaryPath)
      ? JSON.parse(fs.readFileSync(summaryPath, "utf8"))
      : undefined
    if (prior && !gt(parsed.version, prior.version)) continue
    fs.mkdirSync(target, { recursive: true })
    const summary = {
      schemaVersion: 1,
      component,
      track,
      version: parsed.version,
      commit: release.commit,
      publishedAt: release.published_at,
      notesUrl: `https://github.com/davidvanderklay/conduit/releases/tag/${encodeURIComponent(parsed.tag)}`,
      apiLevel: 1,
      minimumApiLevel: 1,
    }
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
    if (metadata) {
      const channel = track === "stable" ? "latest" : "nightly"
      fs.writeFileSync(path.join(target, `${channel}.yml`), stringify(metadata.windows))
      fs.writeFileSync(path.join(target, `${channel}-mac.yml`), stringify(metadata.mac))
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { component, tag } = parseReleaseTag(process.env.RELEASE_TAG, process.env.COMPONENT)
  const repository = process.env.GITHUB_REPOSITORY
  if (repository !== "davidvanderklay/conduit") throw new Error("Unexpected update repository")
  const release = JSON.parse(
    execFileSync("gh", ["api", `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`], {
      encoding: "utf8",
    }),
  )
  release.commit = process.env.RELEASE_REVISION
  // GitHub concurrency queues retain only one pending job. Retry branch races
  // instead of allowing a third component to cancel a pending publisher.
  for (let attempt = 0; attempt < 5; attempt++) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-update-feeds-"))
    const git = (...args) =>
      execFileSync("git", ["-C", temporary, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString("base64")}`,
        },
      }).trim()
    try {
      git("init")
      git("remote", "add", "origin", `https://github.com/${repository}.git`)
      if (git("ls-remote", "--heads", "origin", "update-feeds")) {
        git("fetch", "--depth=1", "origin", "update-feeds")
        git("checkout", "--detach", "FETCH_HEAD")
      }
      writeFeeds(release, component, temporary, process.env.ARTIFACT_DIRECTORY ?? "artifacts")
      git("add", "--all")
      if (git("diff", "--cached", "--name-only")) {
        git(
          "-c",
          "user.name=github-actions",
          "-c",
          "user.email=41898282+github-actions[bot]@users.noreply.github.com",
          "commit",
          "-m",
          `Update ${tag} feed`,
        )
        git("push", "origin", "HEAD:refs/heads/update-feeds")
      }
      break
    } catch (error) {
      if (attempt === 4 || !/\[rejected\]|non-fast-forward|fetch first/.test(String(error.stderr)))
        throw error
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  }
}
