import type { NativeTrack } from "./desktop"
import { coreValue } from "./core"
import { trackLanguageName } from "./track-display"

export interface AudioTrackDisplay {
  primary: string
  secondary: string
}

/** What a track list knows about an audio track; mpv fills it all, browsers and the web engine less. */
export type AudioTrackInfo = Pick<
  NativeTrack,
  "title" | "lang" | "codec" | "audioChannels" | "channelCount" | "sampleRate" | "bitrate"
>

export function audioTrackDisplay(track: AudioTrackInfo, fallback: string): AudioTrackDisplay {
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
