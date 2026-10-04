import { gt, valid } from "semver"

export type UpdateTrack = "stable" | "nightly"
export type ReleaseComponent = "desktop" | "server" | "web" | "android" | "ios"
export const FEED_ROOT = "https://raw.githubusercontent.com/davidvanderklay/conduit/update-feeds"
export const API_LEVEL = 1

export interface ReleaseInfo {
  schemaVersion: 1
  component: ReleaseComponent
  track: UpdateTrack
  version: string
  commit: string
  publishedAt: string
  notesUrl: string
  minimumApiLevel: number
  apiLevel: number
}
export interface ReleaseStatus {
  version: string
  track: UpdateTrack
  release?: ReleaseInfo
  checkedAt?: string
  error?: string
  enabled: boolean
}
export interface DesktopUpdateStatus extends ReleaseStatus {
  platform: string
  installation: "native" | "flatpak" | "appimage" | "unknown" | "development"
  phase: "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error"
  progress?: number
}
export interface SystemUpdateStatus extends ReleaseStatus {
  apiLevel: number
  isOwner: boolean
}
export function isUpdateTrack(value: unknown): value is UpdateTrack {
  return value === "stable" || value === "nightly"
}
export function versionTrack(version: string): UpdateTrack {
  return valid(version) && version.includes("-") ? "nightly" : "stable"
}
export function isNewerRelease(current: string, next: string): boolean {
  return Boolean(valid(current) && valid(next) && gt(next, current))
}
export function feedUrl(component: ReleaseComponent, track: UpdateTrack): string {
  return `${FEED_ROOT}/${component}/${track}`
}

/** Reject feed mixups before comparing versions or displaying release links. */
export function parseReleaseInfo(
  value: unknown,
  component: ReleaseComponent,
  track: UpdateTrack,
): ReleaseInfo {
  if (!value || typeof value !== "object") throw new Error("Invalid update metadata")
  const info = value as Record<string, unknown>
  if (
    info.schemaVersion !== 1 ||
    info.component !== component ||
    info.track !== track ||
    typeof info.version !== "string" ||
    !valid(info.version) ||
    (track === "stable" && info.version.includes("-")) ||
    (info.version.includes("-") && !info.version.includes("-nightly.")) ||
    typeof info.commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(info.commit) ||
    typeof info.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(info.publishedAt)) ||
    typeof info.notesUrl !== "string" ||
    !info.notesUrl.startsWith(
      `https://github.com/davidvanderklay/conduit/releases/tag/${component}%2Fv`,
    ) ||
    typeof info.minimumApiLevel !== "number" ||
    !Number.isSafeInteger(info.minimumApiLevel) ||
    info.minimumApiLevel < 1 ||
    typeof info.apiLevel !== "number" ||
    !Number.isSafeInteger(info.apiLevel) ||
    info.apiLevel < 1
  )
    throw new Error("Invalid update metadata")
  return {
    schemaVersion: 1,
    component,
    track,
    version: info.version,
    commit: info.commit,
    publishedAt: info.publishedAt,
    notesUrl: info.notesUrl,
    minimumApiLevel: info.minimumApiLevel,
    apiLevel: info.apiLevel,
  }
}
const feedCache = new Map<string, { etag?: string; release: ReleaseInfo }>()

export async function fetchReleaseInfo(
  component: ReleaseComponent,
  track: UpdateTrack,
): Promise<ReleaseInfo> {
  const url = `${feedUrl(component, track)}/updates.json`
  const cached = feedCache.get(url)
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      "cache-control": "no-cache",
      ...(cached?.etag ? { "if-none-match": cached.etag } : {}),
    },
  })
  if (response.status === 304 && cached) return cached.release
  if (!response.ok) throw new Error(`Update check failed (${response.status})`)
  const body = await response.text()
  if (body.length > 64_000) throw new Error("Update metadata is too large")
  const release = parseReleaseInfo(JSON.parse(body), component, track)
  feedCache.set(url, { etag: response.headers.get("etag") ?? undefined, release })
  return release
}
