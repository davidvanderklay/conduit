import { describe, expect, it } from "vitest"
import { columnsForWidth } from "./virtual-poster-grid"

describe("poster grid scaling", () => {
  it("uses the available grid width rather than assuming the full viewport", () => {
    expect(columnsForWidth(639)).toBe(2)
    expect(columnsForWidth(640)).toBe(3)
    expect(columnsForWidth(900)).toBe(4)
    expect(columnsForWidth(1280)).toBe(6)
  })
})
