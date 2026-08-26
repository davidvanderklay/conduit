import type { NativeTrack } from "./desktop"
import { trackDisplayName, trackLanguageName } from "./track-display"

export interface AudioTrackDisplay {
  primary: string
  secondary: string
}

export function audioTrackDisplay(track: NativeTrack, fallback: string): AudioTrackDisplay {
  const language = trackLanguageName(track.lang) ?? track.lang ?? "Unknown language"
  const codec = audioCodecName(track.codec)
  const base = trackDisplayName(track, fallback)
  const channelSummary = audioChannelSummary(track.channelCount, track.audioChannels)
  const sampleRate =
    track.sampleRate && track.sampleRate > 0 ? formatSampleRate(track.sampleRate) : undefined
  const bitrate =
    track.bitrate && track.bitrate > 0
      ? `${Math.round(track.bitrate / 1_000).toLocaleString()} kbps`
      : undefined
  const detailedChannels = track.audioChannels?.trim()
  const channels =
    detailedChannels && !/^\d+$/.test(detailedChannels) ? detailedChannels : channelSummary
  const technical = [
    channels,
    sampleRate,
    bitrate,
    codec && !includesText(base, codec) ? codec : undefined,
  ]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(", ")

  return {
    primary: base + (technical ? ` (${technical})` : ""),
    secondary: language,
  }
}

function audioChannelSummary(channelCount?: number, channels?: string): string | undefined {
  if (channelCount === 1) return "Mono"
  if (channelCount === 2) return "Stereo"
  if (channelCount === 6) return "5.1"
  if (channelCount === 8) return "7.1"
  if (channelCount) return `${channelCount} channels`
  return channels?.split("(")[0]?.trim() || undefined
}

function formatSampleRate(sampleRate: number): string {
  const kilohertz = sampleRate / 1_000
  return `${Number.isInteger(kilohertz) ? kilohertz : kilohertz.toFixed(1)} kHz`
}

function audioCodecName(codec?: string): string | undefined {
  const normalized = codec?.split("/").at(-1)?.toLowerCase().replaceAll("_", "-")
  if (!normalized) return undefined
  const names: Record<string, string> = {
    ac3: "AC-3",
    "ac-3": "AC-3",
    eac3: "E-AC-3",
    "e-ac-3": "E-AC-3",
    "ec-3": "E-AC-3",
    truehd: "TrueHD",
    "mlp-fba": "TrueHD",
    "dts-hd": "DTS-HD",
    "dts-hd-ma": "DTS-HD",
    dts: "DTS",
    aac: "AAC",
    "mp4a-latm": "AAC",
    opus: "Opus",
    vorbis: "Vorbis",
    flac: "FLAC",
  }
  return names[normalized] ?? normalized.toUpperCase()
}

function includesText(value: string, part: string): boolean {
  return value.toLocaleLowerCase().includes(part.toLocaleLowerCase())
}
