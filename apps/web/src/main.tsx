import React from "react"
import ReactDOM from "react-dom/client"
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { App } from "./app"
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
const routeTree = rootRoute.addChildren([indexRoute, adminRoute])
const router = createRouter({ routeTree })
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

if ("__TAURI_INTERNALS__" in window && navigator.userAgent.includes("Linux")) {
  document.documentElement.classList.add("linux-desktop")
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
)
