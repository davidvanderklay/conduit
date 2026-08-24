import { createAuthClient } from "better-auth/react"
import { readServerUrl } from "./server"
import { readDesktopSessionToken } from "./desktop-auth"

export const API_URL = readServerUrl()
export const DESKTOP_SESSION_TOKEN = readDesktopSessionToken(API_URL)

export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: {
    headers: DESKTOP_SESSION_TOKEN
      ? { authorization: `Bearer ${DESKTOP_SESSION_TOKEN}` }
      : undefined,
  },
})
