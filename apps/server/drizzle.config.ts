import dotenv from "dotenv"
import { defineConfig } from "drizzle-kit"

dotenv.config({ path: new URL("../../.env", import.meta.url) })

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://conduit:conduit@127.0.0.1:5432/conduit",
  },
})
