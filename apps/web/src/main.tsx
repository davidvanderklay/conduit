import React from "react"
import ReactDOM from "react-dom/client"
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { App } from "./app"
import { ElectronPlayerOverlay } from "./components/electron-player-overlay"
import { isDesktop } from "./lib/desktop"
import "./styles.css"

const rootRoute = createRootRoute()
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: App,
})
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: App,
})
const recoveryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recover/admin",
  component: App,
})
const routeTree = rootRoute.addChildren([indexRoute, adminRoute, recoveryRoute])
const router = createRouter({ routeTree })
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

if (isDesktop() && navigator.userAgent.includes("Linux")) {
  document.documentElement.classList.add("linux-desktop")
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const overlayTitle = new URLSearchParams(window.location.search).get("electronOverlay")
  ? new URLSearchParams(window.location.search).get("title") ?? ""
  : undefined

ReactDOM.createRoot(document.getElementById("root")!).render(
  overlayTitle !== undefined
    ? <ElectronPlayerOverlay initialTitle={overlayTitle} />
    : (
      <React.StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </React.StrictMode>
    ),
)
