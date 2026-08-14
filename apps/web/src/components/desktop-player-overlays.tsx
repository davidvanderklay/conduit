import { useEffect, useState } from "react"
import { LoaderCircle } from "lucide-react"
import type { PlayerArtwork } from "../lib/api"

export function DesktopPlayerOpeningOverlay({
  artwork,
  title,
}: {
  artwork?: PlayerArtwork
  title: string
}) {
  const backgroundSources = [artwork?.background, artwork?.poster].filter(
    (source): source is string => Boolean(source),
  )
  const indicatorSources = [artwork?.logo, artwork?.poster, artwork?.background].filter(
    (source): source is string => Boolean(source),
  )
  const backgroundSignature = backgroundSources.join("|")
  const indicatorSignature = indicatorSources.join("|")
  const [backgroundIndex, setBackgroundIndex] = useState(0)
  const [indicatorIndex, setIndicatorIndex] = useState(0)

  useEffect(() => setBackgroundIndex(0), [backgroundSignature])
  useEffect(() => setIndicatorIndex(0), [indicatorSignature])

  const background = backgroundSources[backgroundIndex]
  const indicator = indicatorSources[indicatorIndex]

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-black"
      role="status"
      aria-label="Video loading"
    >
      {background && (
        <img
          className="absolute inset-0 size-full object-cover"
          src={background}
          alt=""
          onError={() => setBackgroundIndex((current) => current + 1)}
        />
      )}
      <div className="absolute inset-0 bg-black/65" aria-hidden="true" />
      {indicator ? (
        <img
          className="desktop-player-opening-indicator absolute left-1/2 top-1/2 max-h-[100px] w-[28%] max-w-[240px] -translate-x-1/2 -translate-y-1/2 object-contain"
          src={indicator}
          alt={title}
          onError={() => setIndicatorIndex((current) => current + 1)}
        />
      ) : (
        <p className="absolute left-1/2 top-1/2 w-[min(80%,32rem)] -translate-x-1/2 -translate-y-1/2 text-center text-xl font-semibold text-white">
          {title}
        </p>
      )}
    </div>
  )
}

export function DesktopPlayerBufferingOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 grid place-items-center bg-black/55"
      role="status"
      aria-label="Video buffering"
    >
      <LoaderCircle className="desktop-player-buffering-indicator text-white" aria-hidden="true" />
    </div>
  )
}
