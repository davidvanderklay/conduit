import { useEffect, useRef } from "react"
import type Hls from "hls.js"

export function Player({
  url,
  title,
  onClose,
}: {
  url: string
  title: string
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let cancelled = false
    let hls: Hls | undefined

    if (isHls(url)) {
      void import("hls.js").then(({ default: HlsPlayer }) => {
        if (cancelled) return
        if (HlsPlayer.isSupported()) {
          hls = new HlsPlayer()
          hls.loadSource(url)
          hls.attachMedia(video)
        } else {
          video.src = url
        }
      })
    } else {
      video.src = url
    }

    return () => {
      cancelled = true
      hls?.destroy()
      video.removeAttribute("src")
      video.load()
    }
  }, [url])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/95 p-4">
      <div className="w-full max-w-6xl">
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="truncate font-medium">{title}</p>
          <button
            className="rounded-lg px-3 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white"
            onClick={onClose}
          >
            Close player
          </button>
        </div>
        <video
          ref={videoRef}
          className="aspect-video max-h-[80vh] w-full rounded-xl bg-black"
          controls
          autoPlay
          playsInline
        />
        <p className="mt-3 text-xs text-zinc-500">
          Playback is direct from the selected source. Browser codec support varies by operating
          system and format.
        </p>
      </div>
    </div>
  )
}

function isHls(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".m3u8")
  } catch {
    return false
  }
}
