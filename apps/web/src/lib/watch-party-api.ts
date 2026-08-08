import { api } from "./api"
import type {
  WatchPartyInvite,
  WatchPartyMedia,
  WatchPartySummary,
  WatchPartyTicket,
} from "./watch-party"

export interface WatchPartySessionResponse extends WatchPartyTicket {
  party: WatchPartySummary
  invite?: WatchPartyInvite
}

export function listWatchParties(profileId: string) {
  return api<{ parties: WatchPartySummary[] }>(`/v1/watch-parties?profileId=${encodeURIComponent(profileId)}`)
}

export function createWatchParty(
  profileId: string,
  mode: "private" | "shared",
  media: WatchPartyMedia,
) {
  return api<WatchPartySessionResponse>("/v1/watch-parties", {
    method: "POST",
    body: JSON.stringify({ profileId, mode, media }),
  })
}

export function joinWatchParty(partyId: string, profileId: string) {
  return api<WatchPartySessionResponse>(`/v1/watch-parties/${partyId}/join`, {
    method: "POST",
    body: JSON.stringify({ profileId }),
  })
}

export function acceptWatchPartyInvite(token: string, profileId: string) {
  return api<WatchPartySessionResponse>(`/v1/watch-parties/invites/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    body: JSON.stringify({ profileId }),
  })
}

export function createWatchPartyInvite(partyId: string) {
  return api<{ invite: WatchPartyInvite }>(`/v1/watch-parties/${partyId}/invites`, { method: "POST" })
}

export function refreshWatchPartyTicket(partyId: string, profileId: string) {
  return api<WatchPartyTicket>(`/v1/watch-parties/${partyId}/ticket`, {
    method: "POST",
    body: JSON.stringify({ profileId }),
  })
}

export function leaveWatchParty(partyId: string, profileId: string) {
  return api<void>(`/v1/watch-parties/${partyId}/leave`, {
    method: "POST",
    body: JSON.stringify({ profileId }),
  })
}

export function endWatchParty(partyId: string) {
  return api<void>(`/v1/watch-parties/${partyId}/end`, { method: "POST" })
}

export function updateWatchPartyMedia(partyId: string, media: WatchPartyMedia) {
  return api<{ party: WatchPartySummary }>(`/v1/watch-parties/${partyId}/media`, {
    method: "PATCH",
    body: JSON.stringify({ media }),
  })
}
