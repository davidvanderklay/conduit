import { useSyncExternalStore } from "react"
import { useQuery } from "@tanstack/react-query"
import type { DesktopUpdateStatus, SystemUpdateStatus } from "@conduit/updates"
import { api } from "./api"
import { API_URL } from "./auth"

export function useUpdates(isOwner: boolean, accountId: string) {
  const dismissalKey = `conduit:update-notices:${API_URL}:${accountId}`
  const dismissed = useSyncExternalStore(
    (notify) => {
      window.addEventListener("storage", notify)
      window.addEventListener("conduit:update-notices", notify)
      return () => {
        window.removeEventListener("storage", notify)
        window.removeEventListener("conduit:update-notices", notify)
      }
    },
    () => {
      try {
        return window.localStorage.getItem(dismissalKey) ?? ""
      } catch {
        return ""
      }
    },
    () => "",
  )
  const server = useQuery({
    queryKey: ["server-updates", API_URL, isOwner],
    queryFn: () => api<SystemUpdateStatus>(isOwner ? "/v1/admin/updates" : "/v1/system/info"),
    staleTime: 60_000,
    refetchInterval: (query) =>
      query.state.data?.enabled && !query.state.data.checkedAt && !query.state.data.error
        ? 10_000
        : 5 * 60_000,
    retry: false,
  })
  const desktop = useQuery({
    queryKey: ["desktop-updates"],
    queryFn: async () => (await window.__CONDUIT_ELECTRON__?.updates?.("status")) ?? null,
    enabled: Boolean(window.__CONDUIT_ELECTRON__?.updates),
    refetchInterval: (query) => (query.state.data?.phase === "downloading" ? 1000 : 10_000),
    retry: false,
  })
  const token = `${desktop.data?.track}:${desktop.data?.release?.version}|${server.data?.track}:${server.data?.release?.version}`
  const count =
    dismissed === token
      ? 0
      : Number(Boolean(server.data?.release)) + Number(Boolean(desktop.data?.release))
  const dismiss = () => {
    try {
      window.localStorage.setItem(dismissalKey, token)
    } catch {
      return
    }
    window.dispatchEvent(new Event("conduit:update-notices"))
  }
  return { server, desktop, count, dismiss }
}
export type { DesktopUpdateStatus }
