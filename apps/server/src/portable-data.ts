import { parseTrustedHttpUrl } from "./url-security.js"

export const PORTABLE_DATA_FORMAT = "conduit-profile"
export const PORTABLE_DATA_VERSION = 1
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_ITEMS_PER_SECTION = 10_000

export interface PortableProfileData {
  format: typeof PORTABLE_DATA_FORMAT
  version: number
  exportedAt: string
  profile: { name: string; isKids: boolean }
  preferences?: Record<string, unknown>
  library: Array<{
    mediaType: "movie" | "series"
    mediaId: string
    name: string
    poster?: string
    background?: string
    description?: string
    releaseInfo?: string
    runtime?: string
    createdAt: string
    updatedAt: string
  }>
  progress: Array<{
    videoId: string
    mediaType: string
    mediaId: string
    name: string
    poster?: string
    videoTitle?: string
    season?: number
    episode?: number
    positionMs: number
    durationMs: number
    watched: boolean
    dismissed?: boolean
    updatedAt: string
  }>
  addons: Array<{
    manifestId: string
    manifestUrl?: string
    manifest: Record<string, unknown>
    position: number
    enabled: boolean
  }>
}

export interface ImportPreview {
  valid: true
  version: number
  profile: { name: string; isKids: boolean }
  counts: { library: number; progress: number; addons: number }
  importableAddons: number
  warnings: string[]
}

export function validatePortableData(value: unknown): PortableProfileData {
  if (!isRecord(value)) throw new Error("import must be a JSON object")
  if (value.format !== PORTABLE_DATA_FORMAT) throw new Error("unsupported import format")
  if (typeof value.version !== "number" || !Number.isInteger(value.version)) {
    throw new Error("version must be an integer")
  }
  if (value.version > PORTABLE_DATA_VERSION) {
    throw new Error(`archive version ${value.version} is newer than supported version ${PORTABLE_DATA_VERSION}`)
  }
  if (value.version < 1) throw new Error(`unsupported archive version ${value.version}`)
  if (jsonSize(value) > MAX_IMPORT_BYTES) throw new Error("import exceeds the 10 MiB limit")
  assertTimestamp(value.exportedAt, "exportedAt")
  if (!isRecord(value.profile)) throw new Error("profile must be an object")
  assertString(value.profile.name, "profile.name", 1, 80)
  if (typeof value.profile.isKids !== "boolean") throw new Error("profile.isKids must be a boolean")
  if (value.preferences !== undefined && !isRecord(value.preferences)) {
    throw new Error("preferences must be an object")
  }
  assertArray(value.library, "library")
  assertArray(value.progress, "progress")
  assertArray(value.addons, "addons")

  const libraryKeys = new Set<string>()
  for (const [index, raw] of value.library.entries()) {
    const path = `library[${index}]`
    if (!isRecord(raw)) throw new Error(`${path} must be an object`)
    if (raw.mediaType !== "movie" && raw.mediaType !== "series") {
      throw new Error(`${path}.mediaType must be movie or series`)
    }
    assertString(raw.mediaId, `${path}.mediaId`, 1, 512)
    assertString(raw.name, `${path}.name`, 1, 500)
    assertOptionalString(raw.poster, `${path}.poster`, 4096)
    assertOptionalString(raw.background, `${path}.background`, 4096)
    assertOptionalString(raw.description, `${path}.description`, 20_000)
    assertOptionalString(raw.releaseInfo, `${path}.releaseInfo`, 200)
    assertOptionalString(raw.runtime, `${path}.runtime`, 200)
    assertTimestamp(raw.createdAt, `${path}.createdAt`)
    assertTimestamp(raw.updatedAt, `${path}.updatedAt`)
    assertUnique(libraryKeys, `${raw.mediaType}:${raw.mediaId}`, path)
  }

  const videoIds = new Set<string>()
  for (const [index, raw] of value.progress.entries()) {
    const path = `progress[${index}]`
    if (!isRecord(raw)) throw new Error(`${path} must be an object`)
    assertString(raw.videoId, `${path}.videoId`, 1, 512)
    assertString(raw.mediaType, `${path}.mediaType`, 1, 50)
    assertString(raw.mediaId, `${path}.mediaId`, 1, 512)
    assertString(raw.name, `${path}.name`, 1, 500)
    assertOptionalString(raw.poster, `${path}.poster`, 4096)
    assertOptionalString(raw.videoTitle, `${path}.videoTitle`, 500)
    assertOptionalInteger(raw.season, `${path}.season`)
    assertOptionalInteger(raw.episode, `${path}.episode`)
    assertInteger(raw.positionMs, `${path}.positionMs`)
    assertInteger(raw.durationMs, `${path}.durationMs`)
    if (typeof raw.watched !== "boolean") throw new Error(`${path}.watched must be a boolean`)
    if (raw.dismissed !== undefined && typeof raw.dismissed !== "boolean") {
      throw new Error(`${path}.dismissed must be a boolean`)
    }
    assertTimestamp(raw.updatedAt, `${path}.updatedAt`)
    assertUnique(videoIds, raw.videoId, path)
  }

  const addonKeys = new Set<string>()
  for (const [index, raw] of value.addons.entries()) {
    const path = `addons[${index}]`
    if (!isRecord(raw)) throw new Error(`${path} must be an object`)
    assertString(raw.manifestId, `${path}.manifestId`, 1, 500)
    if (raw.manifestUrl !== undefined) {
      assertString(raw.manifestUrl, `${path}.manifestUrl`, 1, 4096)
      parseTrustedHttpUrl(raw.manifestUrl, `${path}.manifestUrl`)
    }
    if (!isRecord(raw.manifest)) throw new Error(`${path}.manifest must be an object`)
    if (jsonSize(raw.manifest) > 256 * 1024) throw new Error(`${path}.manifest exceeds 256 KiB`)
    assertInteger(raw.position, `${path}.position`)
    if (typeof raw.enabled !== "boolean") throw new Error(`${path}.enabled must be a boolean`)
    assertUnique(addonKeys, raw.manifestUrl ?? `redacted:${raw.manifestId}:${raw.position}`, path)
  }
  return value as unknown as PortableProfileData
}

export function previewPortableData(data: PortableProfileData): ImportPreview {
  const importableAddons = data.addons.filter((addon) => addon.manifestUrl).length
  const warnings: string[] = []
  if (importableAddons !== data.addons.length) {
    warnings.push(`${data.addons.length - importableAddons} add-on(s) have redacted URLs and cannot be imported`)
  }
  return {
    valid: true,
    version: data.version,
    profile: data.profile,
    counts: { library: data.library.length, progress: data.progress.length, addons: data.addons.length },
    importableAddons,
    warnings,
  }
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  if (value.length > MAX_ITEMS_PER_SECTION) throw new Error(`${path} exceeds ${MAX_ITEMS_PER_SECTION} items`)
}
function assertString(value: unknown, path: string, min: number, max: number): asserts value is string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new Error(`${path} must be a string between ${min} and ${max} characters`)
  }
}
function assertOptionalString(value: unknown, path: string, max: number) {
  if (value !== undefined && (typeof value !== "string" || value.length > max)) {
    throw new Error(`${path} must be a string no longer than ${max} characters`)
  }
}
function assertInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${path} must be a non-negative integer`)
}
function assertOptionalInteger(value: unknown, path: string) {
  if (value !== undefined) assertInteger(value, path)
}
function assertTimestamp(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${path} must be an ISO timestamp`)
  const year = new Date(value).getUTCFullYear()
  if (year < 1970 || year > 2200) throw new Error(`${path} is outside the supported date range`)
}
function assertUnique(values: Set<string>, key: string, path: string) {
  if (values.has(key)) throw new Error(`${path} duplicates an earlier item`)
  values.add(key)
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function jsonSize(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8")
}
