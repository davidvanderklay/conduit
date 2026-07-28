import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  envDir: "../..",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
})
