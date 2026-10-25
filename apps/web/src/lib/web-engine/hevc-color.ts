/**
 * Rewrites the color description in HEVC sequence parameter sets. Hardware
 * decoders hand frames to WebGPU only as browser-converted textures, so the
 * engine relabels HDR and Dolby Vision streams with a color space whose
 * conversion it can undo in the shader to recover the coded samples.
 * Approach from WebGPU Player (MIT): https://github.com/alchemyyy/WebGPU-Player
 */

/** H.273 code points written into the VUI. */
export interface ColorDescription {
  primaries: number
  transfer: number
  matrix: number
  fullRange: boolean
}

const SPS_NAL_TYPE = 33

/** The VUI fields to overwrite; fields left out keep their coded values. */
export type ColorRewrite = Partial<ColorDescription>

const UNSPECIFIED = 2

/**
 * Returns the SPS NAL unit with its VUI color description fields replaced,
 * inserting the description when the VUI leaves it out. Returns undefined
 * when the SPS has no VUI at all.
 */
export function rewriteSpsColor(nal: Uint8Array, color: ColorRewrite): Uint8Array | undefined {
  const rbsp = unescape(nal.subarray(2))
  const vui = findVuiColor(rbsp)
  if (!vui) return undefined
  const bits: number[] = []
  for (let index = 0; index < rbsp.byteLength * 8; index += 1) {
    bits.push((rbsp[index >> 3] >> (7 - (index & 7))) & 1)
  }
  // Drop rbsp_trailing_bits, since an insertion moves the payload's end.
  bits.length = bits.lastIndexOf(1)
  const field = (value: number | undefined, fallback: number) => toBits(value ?? fallback, 8)
  if (vui.kind === "described") {
    const set = (position: number, value: number | undefined, count: number) => {
      if (value !== undefined) bits.splice(position, count, ...toBits(value, count))
    }
    set(vui.fullRange, color.fullRange === undefined ? undefined : Number(color.fullRange), 1)
    set(vui.primaries, color.primaries, 8)
    set(vui.primaries + 8, color.transfer, 8)
    set(vui.primaries + 16, color.matrix, 8)
  } else {
    const description = [
      ...field(color.primaries, UNSPECIFIED),
      ...field(color.transfer, UNSPECIFIED),
      ...field(color.matrix, UNSPECIFIED),
    ]
    if (vui.kind === "undescribed") {
      if (color.fullRange !== undefined) bits[vui.fullRange] = Number(color.fullRange)
      bits[vui.flag] = 1
      bits.splice(vui.flag + 1, 0, ...description)
    } else {
      // video_format 5 (unspecified), then the range and a present color description.
      bits[vui.flag] = 1
      bits.splice(vui.flag + 1, 0, 1, 0, 1, Number(color.fullRange ?? false), 1, ...description)
    }
  }
  bits.push(1)
  while (bits.length % 8) bits.push(0)
  const bytes = new Uint8Array(bits.length / 8)
  bits.forEach((bit, index) => (bytes[index >> 3] |= bit << (7 - (index & 7))))
  return Uint8Array.from([nal[0], nal[1], ...escape(bytes)])
}

function toBits(value: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => (value >> (count - 1 - index)) & 1)
}

/**
 * Rewrites every SPS in an HEVCDecoderConfigurationRecord (hvcC). Returns
 * undefined unless at least one SPS was rewritten.
 */
export function rewriteHvccColor(record: Uint8Array, color: ColorRewrite): Uint8Array | undefined {
  if (record.byteLength < 23 || record[0] !== 1) return undefined
  const output = [...record.subarray(0, 23)]
  let offset = 23
  let rewritten = 0
  for (let array = 0; array < record[22]; array += 1) {
    const type = record[offset] & 0x3f
    const count = (record[offset + 1] << 8) | record[offset + 2]
    output.push(...record.subarray(offset, offset + 3))
    offset += 3
    for (let index = 0; index < count; index += 1) {
      const length = (record[offset] << 8) | record[offset + 1]
      const nal = record.subarray(offset + 2, offset + 2 + length)
      const replacement = type === SPS_NAL_TYPE ? rewriteSpsColor(nal, color) : undefined
      const result = replacement ?? nal
      if (replacement) rewritten += 1
      output.push(result.byteLength >> 8, result.byteLength & 0xff, ...result)
      offset += 2 + length
    }
  }
  return rewritten ? Uint8Array.from(output) : undefined
}

/** Rewrites in-band SPS NAL units in a length-prefixed access unit, so they match the hvcC. */
export function rewritePacketColor(
  data: Uint8Array,
  lengthSize: number,
  color: ColorRewrite,
): Uint8Array {
  const parts: Uint8Array[] = []
  let changed = false
  let offset = 0
  while (offset + lengthSize <= data.byteLength) {
    let length = 0
    for (let index = 0; index < lengthSize; index += 1) length = length * 256 + data[offset + index]
    const nal = data.subarray(offset + lengthSize, offset + lengthSize + length)
    const replacement =
      ((nal[0] >> 1) & 0x3f) === SPS_NAL_TYPE ? rewriteSpsColor(nal, color) : undefined
    changed ||= replacement !== undefined
    const result = replacement ?? nal
    const prefix = new Uint8Array(lengthSize)
    for (let index = 0, value = result.byteLength; index < lengthSize; index += 1) {
      prefix[lengthSize - 1 - index] = value & 0xff
      value = Math.floor(value / 256)
    }
    parts.push(prefix, result)
    offset += lengthSize + length
  }
  if (!changed) return data
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  parts.reduce((position, part) => (output.set(part, position), position + part.byteLength), 0)
  return output
}

/**
 * Where the VUI keeps its color description: the field offsets when it has one,
 * or the presence flag to set when the VUI leaves the description or the whole
 * video signal type out.
 */
type VuiColor =
  | { kind: "described"; fullRange: number; primaries: number }
  | { kind: "undescribed"; fullRange: number; flag: number }
  | { kind: "no-signal-type"; flag: number }

/** Walks the SPS syntax (H.265 7.3.2.2) up to the VUI color description. */
function findVuiColor(rbsp: Uint8Array): VuiColor | undefined {
  const bits = new BitReader(rbsp)
  bits.skip(4)
  const maxSubLayers = bits.read(3)
  bits.skip(1)
  // profile_tier_level: general profile, then per sub-layer presence flags and fields.
  bits.skip(88 + 8)
  const profilePresent: boolean[] = []
  const levelPresent: boolean[] = []
  for (let layer = 0; layer < maxSubLayers; layer += 1) {
    profilePresent.push(bits.flag())
    levelPresent.push(bits.flag())
  }
  if (maxSubLayers > 0) bits.skip(2 * (8 - maxSubLayers))
  for (let layer = 0; layer < maxSubLayers; layer += 1) {
    if (profilePresent[layer]) bits.skip(88)
    if (levelPresent[layer]) bits.skip(8)
  }
  bits.ue()
  if (bits.ue() === 3) bits.skip(1)
  bits.ue()
  bits.ue()
  if (bits.flag()) for (let side = 0; side < 4; side += 1) bits.ue()
  bits.ue()
  bits.ue()
  const pocLsbBits = bits.ue() + 4
  const orderingForAll = bits.flag()
  for (let layer = orderingForAll ? 0 : maxSubLayers; layer <= maxSubLayers; layer += 1) {
    bits.ue()
    bits.ue()
    bits.ue()
  }
  for (let field = 0; field < 6; field += 1) bits.ue()
  if (bits.flag() && bits.flag()) skipScalingListData(bits)
  bits.skip(2)
  if (bits.flag()) {
    bits.skip(8)
    bits.ue()
    bits.ue()
    bits.skip(1)
  }
  skipShortTermRefPicSets(bits, bits.ue())
  if (bits.flag()) {
    const count = bits.ue()
    for (let index = 0; index < count; index += 1) bits.skip(pocLsbBits + 1)
  }
  bits.skip(2)
  if (!bits.flag()) return undefined
  if (bits.flag() && bits.read(8) === 255) bits.skip(32)
  if (bits.flag()) bits.skip(1)
  const signalTypeFlag = bits.position
  if (!bits.flag()) return { kind: "no-signal-type", flag: signalTypeFlag }
  bits.skip(3)
  const fullRange = bits.position
  bits.skip(1)
  const descriptionFlag = bits.position
  if (!bits.flag()) return { kind: "undescribed", fullRange, flag: descriptionFlag }
  return { kind: "described", fullRange, primaries: bits.position }
}

function skipScalingListData(bits: BitReader) {
  for (let size = 0; size < 4; size += 1) {
    for (let matrix = 0; matrix < 6; matrix += size === 3 ? 3 : 1) {
      if (!bits.flag()) {
        bits.ue()
        continue
      }
      const coefficients = Math.min(64, 1 << (4 + (size << 1)))
      if (size > 1) bits.ue()
      for (let index = 0; index < coefficients; index += 1) bits.ue()
    }
  }
}

function skipShortTermRefPicSets(bits: BitReader, count: number) {
  const deltaCounts: number[] = []
  for (let set = 0; set < count; set += 1) {
    let deltas = 0
    if (set > 0 && bits.flag()) {
      bits.skip(1)
      bits.ue()
      for (let index = 0; index <= deltaCounts[set - 1]; index += 1) {
        if (bits.flag() || bits.flag()) deltas += 1
      }
    } else {
      deltas = bits.ue() + bits.ue()
      for (let index = 0; index < deltas; index += 1) {
        bits.ue()
        bits.skip(1)
      }
    }
    deltaCounts.push(deltas)
  }
}

class BitReader {
  position = 0
  readonly #bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
  }

  read(count: number): number {
    let value = 0
    for (let index = 0; index < count; index += 1) {
      const byte = this.#bytes[this.position >> 3]
      if (byte === undefined) throw new RangeError("HEVC SPS ended early")
      value = value * 2 + ((byte >> (7 - (this.position & 7))) & 1)
      this.position += 1
    }
    return value
  }

  skip(count: number) {
    this.position += count
  }

  flag(): boolean {
    return this.read(1) === 1
  }

  /** Unsigned Exp-Golomb; signed values have the same length, so skipping them can use this too. */
  ue(): number {
    let zeros = 0
    while (!this.flag()) zeros += 1
    return 2 ** zeros - 1 + this.read(zeros)
  }
}

/** Removes emulation prevention bytes (00 00 03). */
function unescape(payload: Uint8Array): Uint8Array {
  const output: number[] = []
  for (let index = 0; index < payload.byteLength; index += 1) {
    if (payload[index] === 3 && index >= 2 && payload[index - 1] === 0 && payload[index - 2] === 0)
      continue
    output.push(payload[index])
  }
  return Uint8Array.from(output)
}

/** Inserts emulation prevention bytes wherever two zeros precede a byte of 3 or less. */
function escape(rbsp: Uint8Array): number[] {
  const output: number[] = []
  let zeros = 0
  for (const byte of rbsp) {
    if (zeros >= 2 && byte <= 3) {
      output.push(3)
      zeros = 0
    }
    output.push(byte)
    zeros = byte === 0 ? zeros + 1 : 0
  }
  return output
}
