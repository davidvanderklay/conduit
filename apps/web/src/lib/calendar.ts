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
  if (!value) return undefined
  const calendarDate = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value)
  if (calendarDate) {
    const [, year, month, day] = calendarDate
    const parsed = new Date(Number(year), Number(month) - 1, Number(day))
    if (
      parsed.getFullYear() === Number(year) &&
      parsed.getMonth() === Number(month) - 1 &&
      parsed.getDate() === Number(day)
    ) {
      return `${year}-${month}-${day}`
    }
    return undefined
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  return [
    parsed.getFullYear(),
    String(parsed.getMonth() + 1).padStart(2, "0"),
    String(parsed.getDate()).padStart(2, "0"),
  ].join("-")
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

