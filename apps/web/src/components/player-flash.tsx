import { useCallback, useEffect, useRef, useState } from "react"

/** Holds a short-lived message confirming actions that have no visible control, such as keyboard speed changes. */
export function usePlayerFlash() {
  const [message, setMessage] = useState<string>()
  const timer = useRef<number | undefined>(undefined)
  const flash = useCallback((next: string) => {
    setMessage(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(undefined), 900)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return [message, flash] as const
}

export function PlayerFlash({ message }: { message?: string }) {
  if (!message) return null
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-6 z-20 text-center text-xl font-semibold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)]"
      aria-live="polite"
    >
      {message}
    </div>
  )
}
