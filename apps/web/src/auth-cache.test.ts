import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"
import { bootstrapQueryKey } from "./app"

describe("authenticated query isolation", () => {
  it("keeps household bootstrap data scoped to the authenticated user", () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(bootstrapQueryKey("user-one"), { households: ["first"] })
    queryClient.setQueryData(bootstrapQueryKey("user-two"), { households: ["second"] })

    expect(queryClient.getQueryData(bootstrapQueryKey("user-one"))).toEqual({
      households: ["first"],
    })
    expect(queryClient.getQueryData(bootstrapQueryKey("user-two"))).toEqual({
      households: ["second"],
    })
  })

  it("removes all authenticated data at a session boundary", () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(bootstrapQueryKey("user-one"), { households: ["private"] })

    queryClient.clear()

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })
})
