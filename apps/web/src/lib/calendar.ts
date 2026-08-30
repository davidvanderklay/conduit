export interface CalendarMonth {
  year: number
  month: number
}

export function monthFor(date: Date): CalendarMonth {
  return { year: date.getFullYear(), month: date.getMonth() }
}

export function shiftMonth(value: CalendarMonth, amount: number): CalendarMonth {
  const date = new Date(value.year, value.month + amount, 1)
  return monthFor(date)
}

export function monthKey(value: CalendarMonth): string {
  return `${value.year}-${String(value.month + 1).padStart(2, "0")}`
}

export function releaseDateKey(value?: string): string | undefined {
  return coreValue<string | null>({ type: "releaseDateKey", value: value ?? null }) ?? undefined
}

export function daysInMonth(value: CalendarMonth): number {
  return new Date(value.year, value.month + 1, 0).getDate()
}

export function mondayOffset(value: CalendarMonth): number {
  return (new Date(value.year, value.month, 1).getDay() + 6) % 7
}

export function dateKey(value: CalendarMonth, day: number): string {
  return `${monthKey(value)}-${String(day).padStart(2, "0")}`
}
import { coreValue } from "./core"

