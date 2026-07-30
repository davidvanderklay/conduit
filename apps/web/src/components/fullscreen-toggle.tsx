import { useEffect, useState } from "react"
import { Maximize, Minimize } from "lucide-react"
import {
  isDesktop,
  nativeFullscreen,
  onNativeFullscreenChange,
  toggleNativeFullscreen,
} from "../lib/desktop"

export function FullscreenToggle() {
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (isDesktop()) {
      let active = true
      let unlisten: (() => void) | undefined

      void nativeFullscreen().then((value) => {
        if (active) setFullscreen(value)
      })
      void onNativeFullscreenChange((value) => {
        if (active) setFullscreen(value)
      }).then((stopListening) => {
        if (active) unlisten = stopListening
        else stopListening()
      })

      return () => {
        active = false
        unlisten?.()
      }
    }

    const syncFullscreen = () => setFullscreen(document.fullscreenElement !== null)
    syncFullscreen()
    document.addEventListener("fullscreenchange", syncFullscreen)
    return () => document.removeEventListener("fullscreenchange", syncFullscreen)
  }, [])

  const label = fullscreen ? "Exit fullscreen" : "Enter fullscreen"

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="grid size-10 shrink-0 place-items-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      onClick={() => {
        if (isDesktop()) {
          void toggleNativeFullscreen().then(setFullscreen)
        } else if (document.fullscreenElement) {
          void document.exitFullscreen()
        } else {
          void document.documentElement.requestFullscreen()
        }
      }}
    >
      {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
    </button>
  )
}
