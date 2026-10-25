import type { AudioCodec, Input, InputAudioTrack } from "mediabunny"

export interface ProbedVideo {
  codecString: string | null
  decodable: boolean
  hdr: boolean
  /** Dolby Vision profile 5, which only the engine's WebGPU path renders in the right colors. */
  dolbyVision: boolean
}

export interface ProbedAudio {
  track: InputAudioTrack
  codec: string | null
  codecString: string | null
  decodable: boolean
  /** The FFmpeg decoder that plays this track when the browser cannot decode it. */
  softwareCodec?: string
  channels: number
  language: string
  name: string | null
  primary: boolean
}

/** What the engine learned about a source before choosing how to play it. */
export interface SourceProbe {
  containerMimeType: string
  video?: ProbedVideo
  audio: ProbedAudio[]
}

export type PlaybackRoute = "native" | "engine"

export interface BrowserPlayback {
  /** True when the `<video>` element reports it can play the full MIME type. */
  canPlayType(type: string): boolean
  webgpu: boolean
}

/**
 * Prefers the native `<video>` element and only routes to the WebCodecs engine
 * when the browser cannot play the container or the primary tracks' codecs,
 * or when the video is HDR and WebGPU can tone map it.
 */
export function choosePlaybackRoute(probe: SourceProbe, browser: BrowserPlayback): PlaybackRoute {
  if (!engineCanPlay(probe)) return "native"
  if ((probe.video?.hdr || probe.video?.dolbyVision) && browser.webgpu) return "engine"
  const primaryAudio = probe.audio.find((audio) => audio.primary) ?? probe.audio[0]
  const nativeVideo =
    !probe.video || nativeCodec(probe.containerMimeType, probe.video.codecString, browser)
  const nativeAudio =
    !primaryAudio || nativeCodec(probe.containerMimeType, primaryAudio.codecString, browser)
  return nativeVideo && nativeAudio ? "native" : "engine"
}

/** The engine needs a decodable video track, or decodable audio for audio-only sources. */
export function engineCanPlay(probe: SourceProbe): boolean {
  return probe.video ? probe.video.decodable : probe.audio.some((audio) => audio.decodable)
}

/**
 * Picks the audio track the engine plays: the primary track when it decodes,
 * otherwise a decodable track in the same language, otherwise any decodable track.
 */
export function engineAudioTrack(audio: readonly ProbedAudio[]): ProbedAudio | undefined {
  const primary = audio.find((track) => track.primary) ?? audio[0]
  if (primary?.decodable) return primary
  return (
    audio.find((track) => track.decodable && track.language === primary?.language) ??
    audio.find((track) => track.decodable)
  )
}

/**
 * The FFmpeg decoder for audio the browser cannot decode. Mediabunny maps DTS but
 * leaves TrueHD and MLP without a codec, so those match on the container's codec ID.
 */
export function softwareAudioCodec(
  codec: AudioCodec | null,
  internalCodecId: unknown,
): string | undefined {
  if (codec === "dts") return "dca"
  if (codec !== null) return undefined
  if (internalCodecId === "A_TRUEHD" || internalCodecId === "mlpa") return "truehd"
  if (internalCodecId === "A_MLP") return "mlp"
  return undefined
}

function nativeCodec(container: string, codecString: string | null, browser: BrowserPlayback) {
  return codecString != null && browser.canPlayType(`${container}; codecs="${codecString}"`)
}

/** Reads container, codec, and decoder support for every track without decoding media. */
export async function probeInput(input: Input, dolbyVision = false): Promise<SourceProbe> {
  const [format, videoTrack, primaryAudio, audioTracks] = await Promise.all([
    input.getFormat(),
    input.getPrimaryVideoTrack(),
    input.getPrimaryAudioTrack(),
    input.getAudioTracks(),
  ])
  const video = videoTrack
    ? {
        codecString: await videoTrack.getCodecParameterString(),
        decodable: await videoTrack.canDecode(),
        hdr: await videoTrack.hasHighDynamicRange(),
        dolbyVision,
      }
    : undefined
  const audio = await Promise.all(
    audioTracks.map(async (track) => {
      const codec = await track.getCodec()
      const browserDecodable = await track.canDecode()
      const softwareCodec = browserDecodable
        ? undefined
        : softwareAudioCodec(codec, await track.getInternalCodecId())
      return {
        track,
        codec,
        codecString: await track.getCodecParameterString(),
        decodable: browserDecodable || softwareCodec !== undefined,
        softwareCodec,
        channels: await track.getNumberOfChannels(),
        language: await track.getLanguageCode(),
        name: await track.getName(),
        primary: track.id === primaryAudio?.id,
      }
    }),
  )
  return { containerMimeType: format.mimeType, video, audio }
}

/** WebCodecs and Web Audio exist only in secure contexts (HTTPS or localhost). */
export function webEngineSupported(): boolean {
  return (
    window.isSecureContext &&
    typeof VideoDecoder === "function" &&
    typeof AudioContext === "function"
  )
}

/** True when the browser hands out a WebGPU adapter, which HDR tone mapping needs. */
export async function webGpuAvailable(): Promise<boolean> {
  return Boolean(await navigator.gpu?.requestAdapter().catch(() => null))
}
