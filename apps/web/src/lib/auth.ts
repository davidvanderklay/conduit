import { createAuthClient } from "better-auth/react"
import { genericOAuthClient } from "better-auth/client/plugins"
import { readServerUrl } from "./server"

export const API_URL = readServerUrl()

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [genericOAuthClient()],
})
