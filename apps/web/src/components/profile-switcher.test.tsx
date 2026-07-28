// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Profile } from "../lib/api"
import { ProfileSwitcher } from "./profile-switcher"

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const profiles: Profile[] = [
  { id: "profile-one", name: "Alex", isKids: false },
  { id: "profile-two", name: "Movie Night", isKids: false },
  { id: "profile-kids", name: "Kids", isKids: true },
]

describe("ProfileSwitcher", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it("shows a dark custom profile menu and reports a selection", () => {
    const onSelect = vi.fn()
    render(onSelect)

    click(button("Switch profile, current profile Alex"))
    const menu = document.querySelector<HTMLElement>('[role="listbox"]')

    expect(menu).not.toBeNull()
    expect(menu?.className).toContain("bg-zinc-950")
    expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain(
      "Alex",
    )

    click(button("Movie Night"))

    expect(onSelect).toHaveBeenCalledWith("profile-two")
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })

  it("dismisses with Escape without changing profiles", () => {
    const onSelect = vi.fn()
    render(onSelect)
    click(button("Switch profile, current profile Alex"))

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })))

    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(button("Switch profile, current profile Alex"))
  })

  function render(onSelect: (profileId: string) => void) {
    act(() => {
      root.render(
        <ProfileSwitcher profiles={profiles} activeProfile={profiles[0]!} onSelect={onSelect} />,
      )
    })
  }
})

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label || candidate.textContent?.includes(label),
  )
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Could not find button "${label}"`)
  return match
}

function click(target: HTMLButtonElement) {
  act(() => target.dispatchEvent(new MouseEvent("click", { bubbles: true })))
}
