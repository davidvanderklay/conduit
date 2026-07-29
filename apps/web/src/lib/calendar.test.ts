import { describe, expect, it } from "vitest"
import {
  dateKey,
  daysInMonth,
  mondayOffset,
  monthKey,
  releaseDateKey,
  shiftMonth,
} from "./calendar"

describe("calendar dates", () => {
  it("navigates across year boundaries", () => {
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
  })

  it("builds a Monday-first calendar", () => {
    expect(mondayOffset({ year: 2026, month: 5 })).toBe(0)
    expect(daysInMonth({ year: 2024, month: 1 })).toBe(29)
    expect(monthKey({ year: 2026, month: 5 })).toBe("2026-06")
    expect(dateKey({ year: 2026, month: 5 }, 3)).toBe("2026-06-03")
  })

  it("preserves release calendar dates and rejects invalid values", () => {
    expect(releaseDateKey("2026-06-03T00:00:00.000Z")).toBe("2026-06-03")
    expect(releaseDateKey("2026-02-30")).toBeUndefined()
    expect(releaseDateKey("sometime")).toBeUndefined()
  })
})

