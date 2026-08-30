import React from "react"
import ReactDOM from "react-dom/client"
import { Minus, Square, X } from "lucide-react"
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { App } from "./app"
import { ElectronPlayerOverlay } from "./components/electron-player-overlay"
import { isDesktop, type PlayerOverlayMedia } from "./lib/desktop"
import { initializeCore } from "./lib/core"
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

const overlayParams = new URLSearchParams(window.location.search)
const overlayMedia: PlayerOverlayMedia | undefined = overlayParams.get("electronOverlay")
  ? {
      title: overlayParams.get("title") ?? "",
      background: overlayParams.get("background") ?? undefined,
      logo: overlayParams.get("logo") ?? undefined,
      poster: overlayParams.get("poster") ?? undefined,
    }
  : undefined

function DesktopTitleBar() {
  return (
    <div className="macos-titlebar">
      <span>conduit</span>
      <div className="windows-titlebar-controls">
        <button
          type="button"
          aria-label="Minimize"
          onClick={() => void window.__CONDUIT_ELECTRON__?.invoke("window_minimize")}
        >
          <Minus size={16} />
        </button>
        <button
          type="button"
          aria-label="Maximize or restore"
          onClick={() => void window.__CONDUIT_ELECTRON__?.invoke("window_toggle_maximize")}
        >
          <Square size={13} />
        </button>
        <button
          type="button"
          className="close"
          aria-label="Close"
          onClick={() => void window.__CONDUIT_ELECTRON__?.invoke("window_close")}
        >
          <X size={17} />
        </button>
      </div>
    </div>
  )
}

void initializeCore().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    overlayMedia !== undefined
      ? <ElectronPlayerOverlay initialMedia={overlayMedia} />
      : (
        <>
          <DesktopTitleBar />
          <React.StrictMode>
            <QueryClientProvider client={queryClient}>
              <RouterProvider router={router} />
            </QueryClientProvider>
          </React.StrictMode>
        </>
      ),
  )
})
