import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import dotenv from "dotenv"
import { createAdminRecoveryLink, ADMIN_RECOVERY_TTL_MINUTES } from "./admin-recovery.js"
import { loadConfig } from "./config.js"
import { createDatabase } from "./db/index.js"

dotenv.config({ path: new URL("../../../.env", import.meta.url) })

const [command, action] = process.argv.slice(2).filter((argument) => argument !== "--")
if (command !== "admin" || action !== "recover") {
  console.error("Usage: conduit admin recover")
  process.exitCode = 1
} else {
  const prompt = createInterface({ input: stdin, output: stdout })
  const email = await prompt.question("Account email: ")
  prompt.close()

  const config = loadConfig()
  const { db, pool } = createDatabase(config.databaseUrl)
  try {
    const recovery = await createAdminRecoveryLink(db, config, email)
    if (!recovery) {
      console.error("No Conduit account was found for that email.")
      process.exitCode = 1
    } else {
      console.log("")
      console.log("One-time local recovery link:")
      console.log(recovery.url)
      console.log("")
      console.log(`Expires in ${ADMIN_RECOVERY_TTL_MINUTES} minutes and can be used once.`)
    }
  } finally {
    await pool.end()
  }
}
