import {
  ALL_FORMATS,
  AudioBufferSink,
  EncodedPacketSink,
  Input,
  UrlSource,
  VideoSampleSink,
  type InputVideoTrack,
  type VideoSample,
} from "mediabunny"
import { enableAv1Metadata, hasAv1DolbyVisionRpu } from "./av1-metadata"
import { findDolbyVisionRpu } from "./dolby-vision"
import { hasEnhancementLayer } from "./dolby-vision-enhancement"
import { MatroskaFile } from "./matroska"
import { downmix71To51, downmixToStereo } from "./downmix"
import type { PlaybackMedia, PlaybackMediaEvent } from "./media"
import { createPresenter, type FramePresenter } from "./presenter"
import { enableRelabeledHevc, hdrTransfer } from "./relabeled-hevc"
import {
  engineAudioTrack,
  probeInput,
  webGpuAvailable,
  type ProbedAudio,
  type SoftwareVideoCodec,
  type SourceProbe,
} from "./route"
import { enableSoftwareHevc, softwareAudioBuffers, softwareVideoSamples } from "./software-decoders"
import { TimeStretcher } from "./time-stretch"
import { FFmpegDecoder } from "./wasm/ffmpeg-decoder"

/** An opened source: its Mediabunny input plus what the probe learned about it. */
export interface WebSource {
  input: Input
  probe: SourceProbe
  videoTrack: InputVideoTrack | null
}

let ac3Decoder: Promise<void> | undefined

/**
 * Opens a URL with HTTP range requests and probes its tracks. Rejects when the
 * host blocks cross-origin reads, so callers can fall back to `<video>`.
 */
export async function openWebSource(url: string): Promise<WebSource> {
  // Mediabunny's default retries keep streaming through network blips and give up at
  // once on suspected CORS errors, which is when `<video>` should take over.
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS })
  try {
    const codecs = await Promise.all(
      (await input.getAudioTracks()).map((track) => track.getCodec()),
    )
    if (codecs.some((codec) => codec === "ac3" || codec === "eac3")) {
      // The WASM AC-3 decoder is ~1 MB, so it loads only for sources that need it.
      ac3Decoder ??= import("@mediabunny/ac3").then(({ registerAc3Decoder }) =>
        registerAc3Decoder(),
      )
      await ac3Decoder
    }
    const videoTrack = await input.getPrimaryVideoTrack()
    const videoConfig = videoTrack && (await videoTrack.getDecoderConfig())
    const videoCodec = videoTrack && (await videoTrack.getCodec())
    const dolbyVision =
      videoTrack !== null &&
      videoConfig !== null &&
      ((videoCodec === "hevc" && (await routeHevc(videoTrack, videoConfig))) ||
        (videoCodec === "av1" && (await routeAv1(videoTrack, videoConfig))))
    // Matroska metadata Mediabunny keeps to itself: codec private data for codecs it
    // does not map, and the HDR peaks in the track's Colour element.
    const matroskaTrack =
      videoTrack && (videoConfig === null || (await videoTrack.hasHighDynamicRange()))
        ? (await (await MatroskaFile.open(url).catch(() => undefined))?.tracks())?.find(
            (track) => track.number === videoTrack.id,
          )
        : undefined
    const [maxCll = 0, mastering = 0] = matroskaTrack?.hdrPeaks ?? []
    const probe = await probeInput(input, {
      dolbyVision,
      videoPrivate: matroskaTrack?.codecPrivate,
      hdrPeak: maxCll || mastering || undefined,
    })
    return { input, probe, videoTrack }
  } catch (error) {
    input.dispose()
    throw error
  }
}

/** Software decoding keeps HDR and Dolby Vision exact, and keeps up, up to this many pixels. */
const SOFTWARE_HEVC_PIXELS = 1920 * 1088

/**
 * Picks the decoder for an HEVC track and returns whether it needs Dolby Vision
 * reshaping. HDR and Dolby Vision decode in software up to 1080p, so the engine
 * reads exact samples; larger frames take the browser's hardware decoder with
 * relabeled color, at 8 bits per channel. Other HEVC uses the browser's decoder,
 * or software when the browser has none.
 */
async function routeHevc(track: InputVideoTrack, config: VideoDecoderConfig): Promise<boolean> {
  const dolbyVision = await needsDolbyVisionReshaping(track, config)
  const transfer = hdrTransfer((await track.getColorSpace()).transfer)
  if (!dolbyVision && !transfer) {
    await enableSoftwareHevc(config)
    return false
  }
  const large =
    (await track.getCodedWidth()) * (await track.getCodedHeight()) > SOFTWARE_HEVC_PIXELS
  const webgpu = await webGpuAvailable()
  const relabeled =
    large &&
    webgpu &&
    (await enableRelabeledHevc(
      config,
      dolbyVision ? { kind: "dolby-vision" } : { kind: "hdr", transfer: transfer! },
    ))
  // Without WebGPU, which reshapes and tone maps, HDR and Dolby Vision are left to the browser.
  if (!relabeled) await enableSoftwareHevc(config, webgpu && (dolbyVision || !large))
  return dolbyVision
}

/**
 * Profile 5 carries RPUs on a base layer that is not HDR10, and profile 7 an
 * enhancement layer whose residual completes its HDR10 base layer. Profile 8's
 * HDR10 base layer plays fine without its RPUs.
 */
async function needsDolbyVisionReshaping(
  track: InputVideoTrack,
  config: VideoDecoderConfig,
): Promise<boolean> {
  const { description } = config
  // hvcC keeps the NAL length size minus one in byte 21; Annex B streams have no hvcC.
  if (!description || description.byteLength <= 21) return false
  const record = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description)
  const lengthSize = (record[21] & 3) + 1
  const packet = await new EncodedPacketSink(track).getFirstKeyPacket()
  if (!packet || !findDolbyVisionRpu(packet.data, lengthSize)) return false
  return !(await track.hasHighDynamicRange()) || hasEnhancementLayer(packet.data, lengthSize)
}

/**
 * Reads the Dolby Vision RPUs (profile 10) and HDR10+ metadata of HDR AV1 tracks,
 * which the browser's decoder drops, when WebGPU can use them. Returns whether
 * the track needs reshaping: profile 10 on a base layer that is not HDR10 or HLG.
 */
async function routeAv1(track: InputVideoTrack, config: VideoDecoderConfig): Promise<boolean> {
  if (!(await webGpuAvailable())) return false
  const packet = await new EncodedPacketSink(track).getFirstKeyPacket()
  const dolbyVision = packet !== null && hasAv1DolbyVisionRpu(packet.data)
  const hdr = await track.hasHighDynamicRange()
  if (!dolbyVision && !hdr) return false
  enableAv1Metadata(config)
  return dolbyVision && !hdr
}

/** Decoded frames from a position on, from the browser's decoder or FFmpeg in a worker. */
type VideoStream = (from: number) => AsyncIterable<VideoSample>

function videoStream(
  track: InputVideoTrack,
  software: SoftwareVideoCodec | undefined,
): VideoStream {
  if (software) return (from) => softwareVideoSamples(track, software, from)
  const sink = new VideoSampleSink(track)
  return (from) => sink.samples(from)
}

/** Decoded audio from a position on, from the browser's decoders or FFmpeg in a worker. */
type AudioStream = (from: number) => AsyncGenerator<{ buffer: AudioBuffer; timestamp: number }>

function audioStream(track: ProbedAudio): AudioStream {
  const { softwareCodec } = track
  if (softwareCodec) return (from) => softwareAudioBuffers(track.track, softwareCodec, from)
  const sink = new AudioBufferSink(track.track)
  return (from) => sink.buffers(from)
}

const MAX_QUEUED_FRAMES = 3
/** Decoded audio kept scheduled ahead of the clock. Covers 1 s timer throttling in hidden tabs. */
const AUDIO_LEAD_SECONDS = 3
/** Audio buffered before playback starts or resumes after a stall. */
const START_AUDIO_SECONDS = 0.3
/** Video this far behind the clock restarts at the nearest keyframe instead of catching up. */
const VIDEO_RESYNC_SECONDS = 1.5
const FRAME_EPSILON = 0.002
const MIN_RATE = 0.25
const MAX_RATE = 4
const MEDIA_ERR_NETWORK = 2
const MEDIA_ERR_DECODE = 3

/**
 * Plays a source with Mediabunny demuxing, WebCodecs (or WASM) decoding, a
 * WebGPU or Canvas 2D presenter, and Web Audio output. It mirrors the parts of
 * `HTMLVideoElement` the player uses, so the player can drive either one.
 *
 * Audio is the clock when there is an audio track. Video frames are pulled
 * against it every animation frame, and playback waits whenever either
 * stream runs dry.
 */
export class WebMediaEngine extends EventTarget implements PlaybackMedia {
  readonly audioTracks: readonly ProbedAudio[]
  readonly #source: WebSource
  readonly #canvas: HTMLCanvasElement
  #presenter?: FramePresenter
  #videoStream?: VideoStream
  #audio?: ProbedAudio
  #audioStream?: AudioStream
  #context?: AudioContext
  #gain?: GainNode
  readonly #sources = new Set<AudioBufferSourceNode>()

  #duration = Number.NaN
  #width = 0
  #height = 0
  #readyState = 0
  #error: { code: number; message: string } | null = null
  #paused = true
  #waiting = false
  #ended = false
  #destroyed = false
  #volume = 1
  #muted = false
  #rate = 1

  // While running, media time = anchorMedia + (clock - anchorClock) * rate.
  #running = false
  #position = 0
  #anchorMedia = 0
  #anchorClock = 0

  #videoGeneration = 0
  #frames: VideoSample[] = []
  #current?: VideoSample
  #videoEnded = false
  #needsPresent = true
  #presenting = false
  #frameDemand?: () => void

  #audioGeneration = 0
  /** Decoded audio waiting to be scheduled; stretched buffers cover `mediaDuration` of media. */
  #pendingAudio: { buffer: AudioBuffer; timestamp: number; mediaDuration: number }[] = []
  #scheduledEnd = 0
  #audioEnded = false

  readonly #recoveries: Record<"video" | "audio", number[]> = { video: [], audio: [] }

  #animationFrame = 0
  #monitorTimer = 0
  #lastTimeUpdate = 0

  constructor(source: WebSource, canvas: HTMLCanvasElement, options: { volume: number }) {
    super()
    this.#source = source
    this.#canvas = canvas
    this.#volume = options.volume
    this.audioTracks = source.probe.audio
  }

  /** Sets up decoding and output, shows the first frame, and optionally starts playback. */
  async load({ autoplay }: { autoplay: boolean }): Promise<void> {
    try {
      const { input, videoTrack } = this.#source
      this.#presenter = await createPresenter(this.#canvas, this.#source.probe.video?.hdrPeak)
      if (videoTrack) {
        this.#videoStream = videoStream(videoTrack, this.#source.probe.video?.software)
        this.#width = await videoTrack.getDisplayWidth()
        this.#height = await videoTrack.getDisplayHeight()
      }
      this.#duration = (await input.getDurationFromMetadata()) ?? (await input.computeDuration())
      if (this.#destroyed) return
      this.#selectAudio(engineAudioTrack(this.audioTracks))
      this.#readyState = 1
      this.#emit("durationchange")
      this.#emit("loadedmetadata")
      // Listeners may already have seeked or pressed play while metadata loaded.
      this.#startVideo(this.#position)
      this.#animationFrame = requestAnimationFrame(this.#tick)
      this.#monitorTimer = window.setInterval(this.#monitor, 100)
      if (!this.#paused) this.#startWaiting()
      else if (autoplay) void this.play().catch(() => undefined)
    } catch (error) {
      this.#fail(error)
    }
  }

  get currentTime(): number {
    if (!this.#running) return this.#position
    const time = this.#anchorMedia + Math.max(0, this.#clock() - this.#anchorClock) * this.#rate
    return Number.isFinite(this.#duration) ? Math.min(time, this.#duration) : time
  }

  set currentTime(time: number) {
    const end = Number.isFinite(this.#duration) ? this.#duration : time
    this.#position = Math.max(0, Math.min(time, end))
    this.#running = false
    this.#ended = false
    this.#startVideo(this.#position)
    if (this.#paused) this.#stopAudio()
    else this.#startWaiting()
    this.#emit("timeupdate")
  }

  get duration(): number {
    return this.#duration
  }

  get paused(): boolean {
    return this.#paused
  }

  get readyState(): number {
    return this.#readyState
  }

  get videoWidth(): number {
    return this.#width
  }

  get videoHeight(): number {
    return this.#height
  }

  get error() {
    return this.#error
  }

  get buffered(): Pick<TimeRanges, "length" | "start" | "end"> {
    const start = this.currentTime
    const lastFrame = this.#frames.at(-1)
    const end = Math.max(
      start,
      lastFrame ? lastFrame.timestamp + lastFrame.duration : 0,
      this.#audioStream ? this.#scheduledEnd : 0,
    )
    return { length: 1, start: () => start, end: () => end }
  }

  get playbackRate(): number {
    return this.#rate
  }

  /** Changes speed from the current position. Audio keeps its pitch, see time-stretch.ts. */
  set playbackRate(rate: number) {
    const next = Math.min(MAX_RATE, Math.max(MIN_RATE, rate))
    // Watch parties reassign the rate on every sync, so an unchanged rate must not rebuffer.
    if (!Number.isFinite(rate) || next === this.#rate) return
    this.#position = this.currentTime
    this.#running = false
    this.#rate = next
    // Audio already scheduled plays at the old speed, so refill it from here.
    if (!this.#paused) this.#startWaiting()
    this.#emit("ratechange")
  }

  get volume(): number {
    return this.#volume
  }

  set volume(volume: number) {
    this.#volume = Math.max(0, Math.min(1, volume))
    this.#applyVolume()
  }

  get muted(): boolean {
    return this.#muted
  }

  set muted(muted: boolean) {
    this.#muted = muted
    this.#applyVolume()
  }

  /** The audio track currently playing, if any track can be decoded. */
  get selectedAudioTrack(): ProbedAudio | undefined {
    return this.#audio
  }

  selectAudioTrack(track: ProbedAudio): void {
    if (!track.decodable || track === this.#audio) return
    this.#selectAudio(track)
    if (!this.#paused) this.#startWaiting()
  }

  async play(): Promise<void> {
    if (this.#error) throw new DOMException(this.#error.message, "NotSupportedError")
    if (!this.#paused) return
    if (this.#ended) {
      this.#ended = false
      this.#position = 0
      this.#startVideo(0)
    }
    this.#paused = false
    this.#emit("play")
    if (!(await this.#resumeAudio())) {
      this.#paused = true
      this.#emit("pause")
      throw new DOMException("The browser blocked audio until the page is used.", "NotAllowedError")
    }
    if (!this.#paused) this.#startWaiting()
  }

  pause(): void {
    if (this.#paused) return
    this.#position = this.currentTime
    this.#running = false
    this.#paused = true
    this.#waiting = false
    this.#stopAudio()
    this.#emit("timeupdate")
    this.#emit("pause")
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    cancelAnimationFrame(this.#animationFrame)
    window.clearInterval(this.#monitorTimer)
    this.#videoGeneration += 1
    this.#frameDemand?.()
    this.#stopAudio()
    this.#frames.forEach((frame) => frame.close())
    this.#frames = []
    this.#current?.close()
    this.#presenter?.destroy()
    void this.#context?.close()
    this.#source.input.dispose()
    FFmpegDecoder.closeIdle()
  }

  /** Resolves false when autoplay policy keeps the audio context suspended, like a rejected `play()`. */
  async #resumeAudio(): Promise<boolean> {
    const context = this.#context
    if (!context || !this.#audioStream) return true
    const running = () => context.state === "running"
    if (running()) return true
    await Promise.race([
      context.resume().catch(() => undefined),
      new Promise((resolve) => window.setTimeout(resolve, 1000)),
    ])
    return running()
  }

  #clock(): number {
    if (!this.#context || !this.#audioStream) return performance.now() / 1000
    return this.#context.currentTime - (this.#context.outputLatency || 0)
  }

  #emit(type: PlaybackMediaEvent | "loadeddata" | "ratechange") {
    this.dispatchEvent(new Event(type))
  }

  #fail(error: unknown, code = error instanceof TypeError ? MEDIA_ERR_NETWORK : MEDIA_ERR_DECODE) {
    if (this.#error || this.#destroyed) return
    this.#error = { code, message: error instanceof Error ? error.message : String(error) }
    this.#position = this.currentTime
    this.#running = false
    this.#paused = true
    this.#waiting = false
    this.#stopAudio()
    this.#emit("error")
  }

  #selectAudio(track: ProbedAudio | undefined) {
    this.#audio = track
    this.#audioStream = track && audioStream(track)
    if (!track) return
    if (!this.#context) {
      this.#context = new AudioContext({ latencyHint: "playback" })
      this.#gain = this.#context.createGain()
      this.#gain.connect(this.#context.destination)
      this.#applyVolume()
    }
    const destination = this.#context.destination
    // Surround output plays as is, 7.1 folds to 5.1 on six channel devices, and anything
    // else the device cannot take is folded to stereo.
    const { channels } = track
    const outputs = destination.maxChannelCount
    destination.channelCount =
      channels > 2 && outputs >= channels ? channels : channels === 8 && outputs >= 6 ? 6 : 2
  }

  #applyVolume() {
    if (this.#gain) this.#gain.gain.value = this.#muted ? 0 : this.#volume
    this.#emit("volumechange")
  }

  /** Freezes the clock and refills audio from the current position before playing on. */
  #startWaiting() {
    this.#position = this.currentTime
    this.#running = false
    this.#waiting = true
    this.#readyState = Math.min(this.#readyState, 2)
    this.#startAudio(this.#position)
    this.#emit("waiting")
  }

  #resume() {
    this.#anchorMedia = this.#position
    this.#anchorClock =
      this.#context && this.#audioStream ? this.#context.currentTime + 0.05 : this.#clock()
    this.#running = true
    this.#waiting = false
    this.#readyState = 4
    this.#scheduleAudio()
    this.#emit("playing")
  }

  #finish() {
    this.#position = Number.isFinite(this.#duration) ? this.#duration : this.currentTime
    this.#running = false
    this.#paused = true
    this.#ended = true
    this.#stopAudio()
    this.#emit("timeupdate")
    this.#emit("pause")
    this.#emit("ended")
  }

  /** Runs every 100 ms, also in hidden tabs: starts, stalls, ends, and time updates. */
  #monitor = () => {
    if (this.#paused || this.#destroyed) return
    if (this.#waiting) {
      if (this.#readyToPlay()) this.#resume()
      return
    }
    const time = this.currentTime
    const frameEnd = this.#current ? this.#current.timestamp + this.#current.duration : 0
    const videoDone = !this.#videoStream || (this.#videoEnded && this.#frames.length === 0)
    const audioDone = !this.#audioStream || (this.#audioEnded && time >= this.#scheduledEnd - 0.01)
    if ((videoDone && audioDone && time >= frameEnd - 0.01) || time >= this.#duration) {
      this.#finish()
      return
    }
    const videoStarved = !videoDone && this.#frames.length === 0 && frameEnd < time - 0.05
    const audioStarved =
      !!this.#audioStream && !this.#audioEnded && time > this.#scheduledEnd - 0.05
    if (videoStarved || audioStarved) {
      this.#startWaiting()
      return
    }
    if (performance.now() - this.#lastTimeUpdate >= 250) {
      this.#lastTimeUpdate = performance.now()
      this.#emit("timeupdate")
      this.#emit("progress")
    }
  }

  #readyToPlay(): boolean {
    const video =
      !this.#videoStream || this.#videoEnded || this.#frames.length >= MAX_QUEUED_FRAMES - 1
    const audio =
      !this.#audioStream || this.#audioEnded || this.#bufferedAudio() >= START_AUDIO_SECONDS
    return video && audio
  }

  /** Presents the newest due frame on each animation frame. */
  #tick = () => {
    this.#animationFrame = requestAnimationFrame(this.#tick)
    if (this.#presenting || !this.#presenter) return
    const time = this.currentTime
    let due: VideoSample | undefined
    while (this.#frames.length > 0 && this.#frames[0].timestamp <= time + FRAME_EPSILON) {
      due?.close()
      due = this.#frames.shift()
    }
    if (!due && this.#needsPresent) due = this.#frames.shift()
    if (!due) return
    this.#frameDemand?.()
    this.#needsPresent = false
    if (this.#running && due.timestamp + due.duration < time - VIDEO_RESYNC_SECONDS) {
      due.close()
      this.#startVideo(time)
      return
    }
    const frame = due
    this.#presenting = true
    this.#presenter.present(frame).then(
      () => {
        this.#presenting = false
        if (this.#destroyed) {
          frame.close()
          return
        }
        this.#current?.close()
        this.#current = frame
        if (this.#readyState < 2) {
          this.#readyState = this.#paused ? 4 : 2
          this.#emit("loadeddata")
          this.#emit("canplay")
        }
      },
      (error: unknown) => {
        this.#presenting = false
        frame.close()
        this.#fail(error)
      },
    )
  }

  #startVideo(from: number) {
    const generation = ++this.#videoGeneration
    this.#frames.forEach((frame) => frame.close())
    this.#frames = []
    this.#videoEnded = false
    this.#needsPresent = true
    this.#frameDemand?.()
    if (this.#videoStream) void this.#runVideo(this.#videoStream, generation, from)
  }

  async #runVideo(stream: VideoStream, generation: number, from: number) {
    try {
      for await (const sample of stream(from)) {
        if (generation !== this.#videoGeneration) {
          sample.close()
          return
        }
        this.#frames.push(sample)
        while (generation === this.#videoGeneration && this.#frames.length >= MAX_QUEUED_FRAMES) {
          await this.#nextFrameDemand()
        }
      }
      if (generation === this.#videoGeneration) this.#videoEnded = true
    } catch (error) {
      if (generation !== this.#videoGeneration) return
      if (this.#mayRecover("video")) this.#startVideo(this.currentTime)
      else this.#fail(error)
    }
  }

  /**
   * Allows restarting a failed decode pipeline at the current position, as when
   * the browser reclaims a hidden tab's hardware decoder, up to twice a minute.
   */
  #mayRecover(pipeline: "video" | "audio"): boolean {
    const now = performance.now()
    const recent = this.#recoveries[pipeline].filter((time) => now - time < 60_000)
    this.#recoveries[pipeline] = [...recent, now]
    return recent.length < 2
  }

  /** Resolves when the presenter takes a frame, or when a newer decode run replaces this one. */
  #nextFrameDemand(): Promise<void> {
    this.#frameDemand?.()
    return new Promise((resolve) => {
      this.#frameDemand = resolve
    })
  }

  #startAudio(from: number) {
    const generation = ++this.#audioGeneration
    this.#stopNodes()
    this.#pendingAudio = []
    this.#audioEnded = false
    this.#scheduledEnd = from
    if (this.#audioStream) void this.#runAudio(this.#audioStream, generation, from)
  }

  #stopAudio() {
    this.#audioGeneration += 1
    this.#stopNodes()
    this.#pendingAudio = []
  }

  async #runAudio(stream: AudioStream, generation: number, from: number) {
    const rate = this.#rate
    let stretcher: TimeStretcher | undefined
    try {
      for await (const { buffer, timestamp } of stream(from)) {
        if (generation !== this.#audioGeneration) return
        const prepared = this.#prepareAudio(buffer)
        if (rate === 1) {
          this.#pendingAudio.push({ buffer: prepared, timestamp, mediaDuration: prepared.duration })
        } else {
          stretcher ??= new TimeStretcher(rate, prepared.sampleRate)
          const channels = Array.from({ length: prepared.numberOfChannels }, (_, index) =>
            prepared.getChannelData(index),
          )
          const stretched = stretcher.push(channels, timestamp, prepared.sampleRate)
          if (!stretched) continue
          const output = new AudioBuffer({
            numberOfChannels: stretched.channels.length,
            length: stretched.channels[0].length,
            sampleRate: prepared.sampleRate,
          })
          stretched.channels.forEach((samples, channel) => output.copyToChannel(samples, channel))
          this.#pendingAudio.push({
            buffer: output,
            timestamp: stretched.timestamp,
            mediaDuration: stretched.mediaDuration,
          })
        }
        this.#scheduleAudio()
        while (generation === this.#audioGeneration && this.#bufferedAudio() > AUDIO_LEAD_SECONDS) {
          await new Promise((resolve) => window.setTimeout(resolve, 100))
        }
      }
      if (generation === this.#audioGeneration) this.#audioEnded = true
    } catch (error) {
      if (generation !== this.#audioGeneration) return
      if (!this.#mayRecover("audio")) this.#fail(error)
      else if (!this.#paused) this.#startWaiting()
    }
  }

  #bufferedAudio(): number {
    if (this.#running) return this.#scheduledEnd - this.currentTime
    return this.#pendingAudio.reduce((total, { mediaDuration }) => total + mediaDuration, 0)
  }

  #scheduleAudio() {
    const context = this.#context
    const gain = this.#gain
    if (!this.#running || !context || !gain) return
    for (const { buffer, timestamp, mediaDuration } of this.#pendingAudio) {
      // Buffers were stretched for the current rate, so media time maps to clock time by it.
      const start = this.#anchorClock + (timestamp - this.#anchorMedia) / this.#rate
      // Skip whatever lies before the anchor or has already passed.
      const offset = Math.max(
        0,
        context.currentTime - start,
        (this.#anchorMedia - timestamp) / this.#rate,
      )
      if (offset >= buffer.duration) continue
      const node = new AudioBufferSourceNode(context, { buffer })
      node.connect(gain)
      node.onended = () => this.#sources.delete(node)
      node.start(start + offset, offset)
      this.#sources.add(node)
      this.#scheduledEnd = Math.max(this.#scheduledEnd, timestamp + mediaDuration)
    }
    this.#pendingAudio = []
  }

  #stopNodes() {
    for (const node of this.#sources) {
      node.onended = null
      node.stop()
      node.disconnect()
    }
    this.#sources.clear()
  }

  /** Folds surround buffers to 5.1 or stereo when the output device cannot play every channel. */
  #prepareAudio(buffer: AudioBuffer): AudioBuffer {
    const outputChannels = this.#context?.destination.channelCount ?? 2
    if (buffer.numberOfChannels <= Math.max(2, outputChannels)) return buffer
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
      buffer.getChannelData(index),
    )
    const folded =
      outputChannels === 6 && channels.length === 8
        ? downmix71To51(channels)
        : downmixToStereo(channels)
    if (!folded) return buffer
    const output = new AudioBuffer({
      numberOfChannels: folded.length,
      length: buffer.length,
      sampleRate: buffer.sampleRate,
    })
    folded.forEach((samples, channel) => output.copyToChannel(samples, channel))
    return output
  }
}
