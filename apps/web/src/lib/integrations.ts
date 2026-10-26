import { useQuery } from "@tanstack/react-query"
import { api } from "./api"

export type IntegrationProviderId = "trakt" | "simkl" | "mdblist"

export interface IntegrationStatus {
  id: IntegrationProviderId
  name: string
  auth: "device" | "apiKey"
  /** False when the server operator has not configured this service. */
  available: boolean
  connection: { accountName: string; lastSyncedAt: string | null; lastError: string | null } | null
}

export interface DeviceSignIn {
  userCode: string
  verificationUrl: string
  interval: number
  expiresIn: number
  /** Opaque server token passed back while polling. */
  handle: string
}

export type DeviceSignInStatus = "pending" | "slow_down" | "expired" | "denied" | "authorized"

export function integrationsQueryKey(profileId: string) {
  return ["integrations", profileId] as const
}

const path = (profileId: string, provider?: IntegrationProviderId) =>
  `/v1/profiles/${profileId}/integrations${provider ? `/${provider}` : ""}`

/** Connection status for the profile. Polls while a first sync is still running. */
export function useIntegrations(profileId: string) {
  return useQuery({
    queryKey: integrationsQueryKey(profileId),
    queryFn: () =>
      api<{ integrations: IntegrationStatus[] }>(path(profileId)).then(
        (result) => result.integrations,
      ),
    refetchInterval: (query) =>
      query.state.data?.some(
        ({ connection }) => connection && !connection.lastSyncedAt && !connection.lastError,
      )
        ? 3_000
        : false,
  })
}

export function startDeviceSignIn(profileId: string, provider: IntegrationProviderId) {
  return api<DeviceSignIn>(`${path(profileId, provider)}/device`, { method: "POST" })
}

export function pollDeviceSignIn(
  profileId: string,
  provider: IntegrationProviderId,
  handle: string,
) {
  return api<{ status: DeviceSignInStatus }>(`${path(profileId, provider)}/device/poll`, {
    method: "POST",
    body: JSON.stringify({ handle }),
  })
}

export function connectApiKey(profileId: string, provider: IntegrationProviderId, apiKey: string) {
  return api<void>(path(profileId, provider), {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  })
}

export function syncIntegration(profileId: string, provider: IntegrationProviderId) {
  return api<{ integrations: IntegrationStatus[] }>(`${path(profileId, provider)}/sync`, {
    method: "POST",
  })
}

export function disconnectIntegration(profileId: string, provider: IntegrationProviderId) {
  return api<void>(path(profileId, provider), { method: "DELETE" })
}
