// @vitest-environment jsdom

import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SubtitleDelayStepper, SubtitlePicker, type SubtitlePickerItem } from "./subtitle-picker"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const items: SubtitlePickerItem[] = [
  {
    key: "external",
    language: "en",
    title: "English · OpenSubtitles",
    detail: "External",
    active: true,
  },
  {
    key: "embedded",
    language: "en-US",
    title: "English",
    detail: "Embedded",
    embedded: true,
    active: false,
  },
]

describe("SubtitlePicker", () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  function render(onOff = vi.fn(), onSelect = vi.fn()) {
    act(() => {
      root.render(
        <SubtitlePicker
          items={items}
          off={false}
          position={90}
          onPositionChange={() => undefined}
          delayMs={0}
          onDelayChange={() => undefined}
          onOff={onOff}
          onSelect={onSelect}
        />,
      )
    })
    return { onOff, onSelect }
  }

  it("clears the selected language when subtitles are turned off", () => {
    const { onOff } = render()

    act(() => {
      host.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.click()
    })

    expect(onOff).toHaveBeenCalledOnce()
    expect(host.querySelector('button[aria-expanded="true"]')).toBeNull()
  })

  it("prefers an embedded variant when a language is selected", () => {
    const { onSelect } = render()
    const language = host.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')

    act(() => language?.click())

    expect(onSelect).toHaveBeenCalledWith("embedded")
  })

  it("steps the delay once per tap and repeats while held", () => {
    vi.useFakeTimers()
    const changes: number[] = []
    function Delay() {
      const [delayMs, setDelayMs] = useState(0)
      return (
        <SubtitleDelayStepper
          delayMs={delayMs}
          onChange={(value) => {
            changes.push(value)
            setDelayMs(value)
          }}
        />
      )
    }
    act(() => root.render(<Delay />))
    const later = host.querySelector<HTMLButtonElement>('[aria-label="Show subtitles later"]')!
    const press = (type: string) =>
      act(() => {
        later.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0 }))
      })
    press("pointerdown")
    press("pointerup")
    expect(changes).toEqual([100])
    press("pointerdown")
    act(() => vi.advanceTimersByTime(600))
    press("pointerup")
    act(() => vi.advanceTimersByTime(1000))
    expect(changes).toEqual([100, 200, 300, 400, 500])
    expect(host.textContent).toContain("+0.5s")
    vi.useRealTimers()
  })
})
