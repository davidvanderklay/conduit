// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SubtitlePicker, type SubtitlePickerItem } from "./subtitle-picker"

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
})
