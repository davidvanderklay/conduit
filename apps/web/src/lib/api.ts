import { API_URL } from "./auth"

export interface Profile {
  id: string
  name: string
  isKids: boolean
}

export interface Household {
  id: string
  name: string
  role: string
  profiles: Profile[]
}

export interface Bootstrap {
  households: Household[]
}

export interface AddonManifest {
  id: string
  version: string
  name: string
  description?: string
  logo?: string
  resources: Array<
    | string
    | {
        name: string
        types?: string[]
        idPrefixes?: string[]
      }
  >
  types: string[]
  catalogs: Array<{
    id: string
    type: string
    name?: string
    extra?: Array<{ name: string; isRequired?: boolean }>
  }>
}

export interface InstalledAddon {
  id: string
  manifestId: string
  manifestUrl: string
  manifest: AddonManifest
  position: number
  enabled: boolean
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with ${response.status}`)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}
