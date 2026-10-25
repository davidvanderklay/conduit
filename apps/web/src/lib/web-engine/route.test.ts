import { describe, expect, it } from "vitest"
import type { InputAudioTrack } from "mediabunny"
import {
  choosePlaybackRoute,
  engineAudioTrack,
  softwareAudioCodec,
  softwareVideoCodec,
  type ProbedAudio,
  type SourceProbe,
} from "./route"

function audio(codecString: string, overrides: Partial<ProbedAudio> = {}): ProbedAudio {
  return {
    track: {} as InputAudioTrack,
    codec: codecString,
    codecString,
    decodable: true,
    channels: 6,
    language: "eng",
    name: null,
    primary: true,
    ...overrides,
  }
}

function probe(overrides: Partial<SourceProbe> = {}): SourceProbe {
  return {
    containerMimeType: "video/x-matroska",
    video: { codecString: "avc1.640028", decodable: true, hdr: false, dolbyVision: false },
    audio: [audio("mp4a.40.2")],
    ...overrides,
  }
}

const chrome = {
  canPlayType: (type: string) => !type.includes("ac-3") && !type.includes("hvc1"),
  webgpu: true,
}

describe("choosePlaybackRoute", () => {
  it("leaves sources the browser plays to the video element", () => {
    expect(choosePlaybackRoute(probe(), chrome)).toBe("native")
  })

  it("uses the engine when the primary audio codec is not playable natively", () => {
    expect(choosePlaybackRoute(probe({ audio: [audio("ac-3")] }), chrome)).toBe("engine")
  })

  it("uses the engine for HDR video only when WebGPU can tone map it", () => {
    const hdr = probe({
      video: { codecString: "vp09.02.10.10", decodable: true, hdr: true, dolbyVision: false },
    })
    expect(choosePlaybackRoute(hdr, chrome)).toBe("engine")
    expect(choosePlaybackRoute(hdr, { ...chrome, webgpu: false })).toBe("native")
  })

  it("lets the video element try video the engine cannot decode", () => {
    const hevc = probe({
      video: { codecString: "hvc1.2.4.L120.B0", decodable: false, hdr: false, dolbyVision: false },
      audio: [audio("ac-3")],
    })
    expect(choosePlaybackRoute(hevc, chrome)).toBe("native")
  })
})

describe("engineAudioTrack", () => {
  it("falls back to a decodable track in the primary track's language", () => {
    const dts = audio("dts", { decodable: false })
    const commentary = audio("mp4a.40.2", { primary: false, language: "fra" })
    const english = audio("ac-3", { primary: false })
    expect(engineAudioTrack([dts, commentary, english])).toBe(english)
  })

  it("plays nothing when no audio track decodes", () => {
    expect(engineAudioTrack([audio("dts", { decodable: false })])).toBeUndefined()
  })
})

describe("softwareAudioCodec", () => {
  it("decodes DTS by codec and TrueHD or MLP by container codec ID", () => {
    expect(softwareAudioCodec("dts", "A_DTS")).toBe("dca")
    expect(softwareAudioCodec(null, "A_TRUEHD")).toBe("truehd")
    expect(softwareAudioCodec(null, "mlpa")).toBe("truehd")
    expect(softwareAudioCodec(null, "A_MLP")).toBe("mlp")
  })

  it("leaves codecs the browser or Mediabunny decode alone", () => {
    expect(softwareAudioCodec("ac3", "A_AC3")).toBeUndefined()
    expect(softwareAudioCodec(null, "A_REAL/COOK")).toBeUndefined()
  })
})

describe("softwareVideoCodec", () => {
  it("maps Matroska codec IDs and keeps their setup data", () => {
    const vol = Uint8Array.of(0, 0, 1, 0xb0)
    expect(softwareVideoCodec("V_MPEG2")).toEqual({ codec: "mpeg2video", extradata: undefined })
    expect(softwareVideoCodec("V_MPEG4/ISO/ASP", vol)).toEqual({ codec: "mpeg4", extradata: vol })
  })

  it("reads the FourCC of a VFW header and passes on what follows it", () => {
    const header = new Uint8Array(44)
    header.set(
      [..."WVC1"].map((letter) => letter.charCodeAt(0)),
      16,
    )
    header.set([1, 2, 3, 4], 40)
    expect(softwareVideoCodec("V_MS/VFW/FOURCC", header)).toEqual({
      codec: "vc1",
      extradata: Uint8Array.of(1, 2, 3, 4),
    })
  })

  it("maps MPEG-TS stream types and ignores codecs it does not know", () => {
    expect(softwareVideoCodec(0x02)).toEqual({ codec: "mpeg2video" })
    expect(softwareVideoCodec("V_THEORA")).toBeUndefined()
  })
})
