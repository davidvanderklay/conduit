import { describe, expect, it } from "vitest"
import { cueText } from "./matroska-subtitles"

describe("cueText", () => {
  it("keeps SRT text and normalizes line endings", () => {
    expect(cueText("S_TEXT/UTF8", "Line one\r\n<i>Line two</i>\r\n")).toBe(
      "Line one\n<i>Line two</i>",
    )
  })

  it("takes the text field of an ASS event and keeps only italics", () => {
    expect(
      cueText("S_TEXT/ASS", "12,0,Default,,0,0,0,,{\\an8}{\\i1}Hello{\\i0}, there\\Nsecond\\hline"),
    ).toBe("<i>Hello</i>, there\nsecond line")
  })
})
