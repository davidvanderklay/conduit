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

  it("creates a profile from the switcher", async () => {
    const onCreate = vi.fn(async () => undefined)
    render(vi.fn(), onCreate)

    click(button("Switch profile, current profile Alex"))
    click(button("Add profile"))

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    const name = document.querySelector<HTMLInputElement>('input[placeholder="Who’s watching?"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Taylor")
      name.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await act(async () => {
      button("Create profile").click()
    })

    expect(onCreate).toHaveBeenCalledWith({
      name: "Taylor",
      isKids: false,
      copyAddons: true,
      usesPrimaryAddons: false,
      avatarColor: "#FFC107",
      avatarUrl: null,
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("collapses large profile lists until requested", () => {
    const manyProfiles = [
      ...profiles,
      { id: "profile-four", name: "Taylor", isKids: false },
      { id: "profile-five", name: "Friends", isKids: false },
      { id: "profile-six", name: "Parents", isKids: false },
    ]
    act(() => {
      root.render(
        <ProfileSwitcher
          profiles={manyProfiles}
          activeProfile={manyProfiles[0]!}
          onSelect={vi.fn()}
        />,
      )
    })

    click(button("Switch profile, current profile Alex"))
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(4)
    click(button("Show 2 more profiles"))
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(6)
  })

  function render(
    onSelect: (profileId: string) => void,
    onCreate?: (values: { name: string; isKids: boolean; copyAddons: boolean }) => Promise<void>,
  ) {
    act(() => {
      root.render(
        <ProfileSwitcher
          profiles={profiles}
          activeProfile={profiles[0]!}
          onSelect={onSelect}
          onCreate={onCreate}
        />,
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
