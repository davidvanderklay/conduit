import { describe, expect, it } from "vitest"
import { posterColumnsForWidth } from "./poster-layout"

describe("poster grid scaling", () => {
  it("uses the available grid width rather than assuming the full viewport", () => {
    expect(posterColumnsForWidth(339)).toBe(2)
    expect(posterColumnsForWidth(340)).toBe(3)
    expect(posterColumnsForWidth(900)).toBe(5)
    expect(posterColumnsForWidth(1280)).toBe(7)
  })
})
