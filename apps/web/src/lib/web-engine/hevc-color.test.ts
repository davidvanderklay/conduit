import { describe, expect, it } from "vitest"
import { rewriteHvccColor, rewritePacketColor, rewriteSpsColor } from "./hevc-color"

const hex = (value: string) => Uint8Array.from(value.match(/../g)!, (byte) => parseInt(byte, 16))
const bytes = (...parts: ArrayLike<number>[]) =>
  Uint8Array.from(parts.flatMap((part) => Array.from(part)))
/** NAL units with 4-byte length prefixes, as MP4 and Matroska store them. */
const lengthPrefixed = (...nals: Uint8Array[]) =>
  bytes(...nals.flatMap((nal) => [[0, 0, 0, nal.byteLength], nal]))

// x265 SPS units from the test media. The expected rewrites were checked with
// FFmpeg's trace_headers and decode to the same frames as the originals.
const HDR10_SPS = hex(
  "42010102200000030090000003000003005da00280802d136595952930b9a84880482000000300200000030301",
)
const HDR10_RELABELED = hex(
  "42010102200000030090000003000003005da00280802d136595952930b9a80868302000000300200000030301",
)
const UNDESCRIBED_SPS = hex(
  "42010102200000030090000003000003005da00280802d136592a4932b9b020000030002000003003010",
)
const UNDESCRIBED_RELABELED = hex(
  "42010102200000030090000003000003005da00280802d136592a4932b9b808683020000030002000003003010",
)
const RELABEL = { primaries: 1, transfer: 13, matrix: 6 }

describe("rewriteSpsColor", () => {
  it("overwrites an existing color description in place", () => {
    expect(rewriteSpsColor(HDR10_SPS, RELABEL)).toEqual(HDR10_RELABELED)
  })

  it("inserts a color description the VUI leaves out", () => {
    expect(rewriteSpsColor(UNDESCRIBED_SPS, RELABEL)).toEqual(UNDESCRIBED_RELABELED)
  })
})

describe("rewriteHvccColor", () => {
  it("rewrites the SPS inside an hvcC record and keeps its other units", () => {
    const vps = hex("40010c01")
    // An hvcC header with lengthSizeMinusOne 3 and two arrays: one VPS, one SPS.
    const record = bytes(
      [1],
      Array.from({ length: 20 }, () => 0),
      [0x0f, 2],
      [0x20, 0, 1, 0, vps.byteLength],
      vps,
      [0x21, 0, 1, 0, HDR10_SPS.byteLength],
      HDR10_SPS,
    )
    const rewritten = rewriteHvccColor(record, RELABEL)!
    expect(rewritten.subarray(0, 23 + 5 + vps.byteLength)).toEqual(
      record.subarray(0, 23 + 5 + vps.byteLength),
    )
    expect(rewritten.subarray(rewritten.byteLength - HDR10_RELABELED.byteLength)).toEqual(
      HDR10_RELABELED,
    )
  })
})

describe("rewritePacketColor", () => {
  it("rewrites in-band SPS units and fixes their length prefixes", () => {
    const slice = hex("2601af")
    expect(rewritePacketColor(lengthPrefixed(UNDESCRIBED_SPS, slice), 4, RELABEL)).toEqual(
      lengthPrefixed(UNDESCRIBED_RELABELED, slice),
    )
  })

  it("returns packets without an SPS untouched", () => {
    const packet = hex("000000032601af")
    expect(rewritePacketColor(packet, 4, RELABEL)).toBe(packet)
  })
})
