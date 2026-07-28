import dotenv from "dotenv"
import { buildApp } from "./app.js"
import { loadConfig } from "./config.js"
import { createDatabase } from "./db/index.js"

dotenv.config({ path: new URL("../../../.env", import.meta.url) })

const config = loadConfig()
const { db, pool } = createDatabase(config.databaseUrl)
const app = await buildApp(config, db)

const close = async () => {
  await app.close()
  await pool.end()
}

process.on("SIGINT", close)
process.on("SIGTERM", close)

await app.listen({ host: "0.0.0.0", port: config.port })
