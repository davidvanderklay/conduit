import fs from "node:fs"
import { pathToFileURL } from "node:url"

const numeric = "(?:0|[1-9][0-9]*)"
const identifier = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`
const semver = new RegExp(
  `^${numeric}\\.${numeric}\\.${numeric}(?:-${identifier}(?:\\.${identifier})*)?$`,
)

export function parseReleaseTag(tag, expectedComponent) {
  const match = /^(server|web|desktop|android|ios)\/v(.+)$/.exec(tag)
  if (!match || match[0] !== tag || !semver.test(match[2]))
    throw new Error(`Invalid component release tag: ${tag}`)
  const [, component, version] = match
  const allowed = expectedComponent === "container" ? ["server", "web"] : [expectedComponent]
  if (!allowed.includes(component))
    throw new Error(`Expected ${expectedComponent} release, got ${component}`)
  return { component, version, tag, prerelease: version.includes("-") }
}

// The offset exceeds the legacy release workflow's build numbers. Never lower it.
export function mobileBuildNumber(runNumber, offset = "1000000") {
  if (!/^[1-9][0-9]*$/.test(runNumber) || !/^[1-9][0-9]*$/.test(offset)) {
    throw new Error("Mobile build number and offset must be positive integers")
  }
  const buildNumber = Number(offset) + Number(runNumber)
  if (!Number.isSafeInteger(buildNumber) || buildNumber > 2100000000) {
    throw new Error("Mobile build number exceeds Android's versionCode limit")
  }
  return String(buildNumber)
}

export function releaseContext(component, env) {
  const publishing = env.GITHUB_EVENT_NAME === "push"
  if (publishing && env.GITHUB_REF_TYPE !== "tag") throw new Error("Releases require a tag push")
  const tag = publishing ? env.GITHUB_REF_NAME : env.RELEASE_TAG
  const release = tag
    ? parseReleaseTag(tag, component)
    : { component, version: `0.0.0-ci.${env.GITHUB_RUN_NUMBER}`, tag: "", prerelease: true }
  if (!tag && component === "container") throw new Error("Container builds require a component tag")
  return {
    ...release,
    publish: String(publishing),
    build_number: mobileBuildNumber(
      env.GITHUB_RUN_NUMBER,
      env.MOBILE_BUILD_NUMBER_OFFSET || undefined,
    ),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const context = releaseContext(process.argv[2], process.env)
  const output =
    Object.entries(context)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n"
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, output)
  else process.stdout.write(output)
}
