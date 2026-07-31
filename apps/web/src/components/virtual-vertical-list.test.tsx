// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { VirtualVerticalList } from "./virtual-vertical-list"

const measure = vi.fn()

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 500,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 500,
      })),
    measureElement: () => undefined,
    measure,
  }),
}))

describe("VirtualVerticalList", () => {
  afterEach(() => {
    document.body.innerHTML = ""
    measure.mockClear()
  })

  it("preserves measured row heights when the parent recreates the items array", () => {
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    const render = (items: Array<{ id: string }>) =>
      root.render(
        <VirtualVerticalList
          items={items}
          itemKey={(item) => item.id}
          renderItem={(item) => <div>{item.id}</div>}
        />,
      )

    act(() => render([{ id: "popular" }, { id: "featured" }]))
    act(() => render([{ id: "popular" }, { id: "featured" }]))

    expect(measure).not.toHaveBeenCalled()
    act(() => root.unmount())
  })
})
