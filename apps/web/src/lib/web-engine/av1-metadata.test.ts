import { describe, expect, it } from "vitest"
import { hasAv1DolbyVisionRpu, t35Payloads } from "./av1-metadata"

const temporalDelimiter = [0x12, 0x00]
/** A metadata OBU (type 5) with an extension byte and a size field, carrying an ITU-T T.35 payload. */
const metadata = (payload: number[]) => [0x2e, 0x00, payload.length + 1, 0x04, ...payload]
/** A frame OBU (type 6) without a size field, as the last OBU of a temporal unit may be. */
const frame = [0x30, 0x10, 0x20, 0x30]

describe("t35Payloads", () => {
  it("yields the T.35 payloads of a temporal unit's metadata OBUs", () => {
    const rpu = [0xb5, 0x00, 0x3b, 0x00, 0x00, 0x08, 0x00, 0x01, 0xbe]
    const hdr10Plus = [0xb5, 0x00, 0x3c, 0x00, 0x01, 0x04, 0x01]
    const unit = Uint8Array.from([
      ...temporalDelimiter,
      ...metadata(rpu),
      ...metadata(hdr10Plus),
      ...frame,
    ])
    expect([...t35Payloads(unit)].map((payload) => Array.from(payload))).toEqual([rpu, hdr10Plus])
    expect(hasAv1DolbyVisionRpu(unit)).toBe(true)
  })

  it("finds no RPU in a temporal unit without one", () => {
    expect(hasAv1DolbyVisionRpu(Uint8Array.from([...temporalDelimiter, ...frame]))).toBe(false)
  })
})
