export type SkipSegmentType = "intro" | "outro" | "recap"

export interface SkipSegment {
  start: number
  end: number
  type: SkipSegmentType
}

interface IntroDbSegment {
  start_sec?: number
  end_sec?: number
  start_ms?: number
  end_ms?: number
}

interface IntroDbResponse {
  intro?: IntroDbSegment
  outro?: IntroDbSegment
  recap?: IntroDbSegment
}

const UP_NEXT_WINDOW_SECONDS = 30
const INTRODB_BASE_URL = "https://api.introdb.app"

export function activeSkipSegment(
  position: number,
  segments: SkipSegment[],
): SkipSegment | undefined {
  return segments.find((segment) => position >= segment.start && position < segment.end)
}

export function shouldShowUpNext(
  position: number,
  duration: number,
  segments: SkipSegment[],
): boolean {
  if (duration <= 0) return false
  const remaining = duration - position
  const inNormalWindow = remaining > 0 && remaining <= UP_NEXT_WINDOW_SECONDS
  const outros = segments.filter((segment) => segment.type === "outro")
  if (!outros.length) return inNormalWindow
  const lastOutroEnd = Math.max(...outros.map((segment) => segment.end))
  if (duration - lastOutroEnd > UP_NEXT_WINDOW_SECONDS) return inNormalWindow
  return position >= Math.min(...outros.map((segment) => segment.start))
}

export function skipSegmentLabel(type: SkipSegmentType): string {
  if (type === "intro") return "Skip intro"
  if (type === "outro") return "Skip outro"
  return "Skip recap"
}

export function parseIntroDbSegments(value: unknown): SkipSegment[] {
  if (!value || typeof value !== "object") return []
  const response = value as IntroDbResponse
  return (["intro", "recap", "outro"] as const).flatMap((type) => {
    const segment = response[type]
    if (!segment) return []
    const start = seconds(segment.start_sec, segment.start_ms)
    const end = seconds(segment.end_sec, segment.end_ms)
    return start === undefined || end === undefined || end <= start ? [] : [{ start, end, type }]
  })
}

export async function loadSkipSegments(
  mediaId: string,
  season: number | undefined,
  episode: number | undefined,
): Promise<SkipSegment[]> {
  const imdbId = mediaId.split(":", 1)[0]
  if (!imdbId.startsWith("tt") || !season || !episode || season < 1 || episode < 1) return []
  try {
    const response = await fetch(
      `${INTRODB_BASE_URL}/segments?imdb_id=${encodeURIComponent(imdbId)}&season=${season}&episode=${episode}`,
    )
    if (!response.ok) return []
    return parseIntroDbSegments(await response.json())
  } catch {
    return []
  }
}

function seconds(secondsValue: number | undefined, millisecondsValue: number | undefined) {
  if (Number.isFinite(millisecondsValue)) return millisecondsValue! / 1000
  return Number.isFinite(secondsValue) ? secondsValue : undefined
}
