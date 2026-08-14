import type { ReactNode } from "react"
import { Maximize, Minimize, Play } from "lucide-react"

type DesktopPlayerChromeTopProps = {
  expandedControls: boolean
  visible: boolean
  fullscreen: boolean
  fullscreenDisabled?: boolean
  heading: ReactNode
  description?: ReactNode
  onBack: () => void
  onFullscreen?: () => void
}

export function DesktopPlayerChromeTop({
  expandedControls,
  visible,
  fullscreen,
  fullscreenDisabled = false,
  heading,
  description,
  onBack,
  onFullscreen,
}: DesktopPlayerChromeTopProps) {
  return (
    <div
      data-player-chrome="top"
      className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4 bg-gradient-to-b from-black/85 via-black/45 to-transparent ${
        expandedControls ? "px-10 pb-8 pt-5" : "px-5 pb-6 pt-3"
      } ${visible ? "visible" : "invisible"}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          className={`pointer-events-auto grid shrink-0 place-items-center rounded-full bg-black/60 text-zinc-200 hover:bg-white/15 ${
            expandedControls ? "size-13 [&_svg]:size-7" : "size-10"
          }`}
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onBack()
          }}
          aria-label="Back to details"
          data-native-overlay
        >
          <Play className="rotate-180 fill-current" size={21} />
        </button>
        <div className="min-w-0" data-native-overlay>
          {heading}
          {description}
        </div>
      </div>
      <button
        className={`pointer-events-auto grid shrink-0 place-items-center rounded-full bg-black/60 text-zinc-200 hover:bg-white/15 ${
          expandedControls ? "size-13 [&_svg]:size-7" : "size-10"
        }`}
        type="button"
        aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        data-native-overlay
        disabled={fullscreenDisabled}
        onClick={onFullscreen}
      >
        {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
      </button>
    </div>
  )
}

export function DesktopPlayerChromeBottom({
  expandedControls,
  visible,
  children,
}: {
  expandedControls: boolean
  visible: boolean
  children: ReactNode
}) {
  return (
    <div
      data-player-chrome="bottom"
      className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/55 to-transparent ${
        expandedControls ? "px-10 pb-6 pt-6" : "px-4 pb-3 pt-8 sm:px-6"
      } ${visible ? "visible" : "pointer-events-none invisible"}`}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={`native-controls-surface relative mx-auto ${
          expandedControls ? "max-w-none" : "max-w-7xl"
        }`}
      >
        {children}
      </div>
    </div>
  )
}

export function DesktopPlayerChrome({
  bottom,
  ...topProps
}: DesktopPlayerChromeTopProps & { bottom: ReactNode }) {
  return (
    <>
      <DesktopPlayerChromeTop {...topProps} />
      <DesktopPlayerChromeBottom
        expandedControls={topProps.expandedControls}
        visible={topProps.visible}
      >
        {bottom}
      </DesktopPlayerChromeBottom>
    </>
  )
}

export function DesktopPlayerControl({
  label,
  active,
  expanded,
  disabled = false,
  children,
  onClick,
}: {
  label: string
  active?: boolean
  expanded?: boolean
  disabled?: boolean
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      className={`relative grid place-items-center rounded-lg bg-zinc-950 text-zinc-200 shadow-sm transition hover:bg-zinc-800 hover:text-white ${
        expanded ? "size-12 [&_svg]:size-7" : "size-10"
      } ${active ? "bg-amber-950 text-amber-300" : ""}`}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
