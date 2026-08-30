import type { NativeTrack } from "./desktop"
import { coreValue } from "./core"
import { trackLanguageName } from "./track-display"

export interface AudioTrackDisplay {
  primary: string
  secondary: string
}

export function audioTrackDisplay(track: NativeTrack, fallback: string): AudioTrackDisplay {
  const language = trackLanguageName(track.lang) ?? track.lang ?? "Unknown language"
  return coreValue<AudioTrackDisplay>({
    type: "audioTrackDisplay",
    info: {
      title: track.title ?? "",
      languageName: language,
      codec: track.codec,
      channels: track.audioChannels,
      channelCount: track.channelCount,
      sampleRate: track.sampleRate,
      bitrate: track.bitrate,
    },
    fallback,
  })
}
