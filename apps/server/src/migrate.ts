import dotenv from "dotenv"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { loadConfig } from "./config.js"
import { createDatabase } from "./db/index.js"

dotenv.config({ path: new URL("../../../.env", import.meta.url) })

const config = loadConfig()
const { db, pool } = createDatabase(config.databaseUrl)

try {
  await migrate(db, {
    migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
  })
} finally {
  await pool.end()
}
