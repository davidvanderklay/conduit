import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import dotenv from "dotenv"
import { createAdminRecoveryLink, ADMIN_RECOVERY_TTL_MINUTES } from "./admin-recovery.js"
import { createOwnerAccount } from "./bootstrap.js"
import { loadConfig } from "./config.js"
import { createDatabase } from "./db/index.js"

dotenv.config({ path: new URL("../../../.env", import.meta.url) })

const [command, action] = process.argv.slice(2).filter((argument) => argument !== "--")
if (command !== "admin" || !["recover", "create-owner"].includes(action ?? "")) {
  console.error("Usage: conduit admin recover | conduit admin create-owner")
  process.exitCode = 1
} else {
  const config = loadConfig()
  const { db, pool } = createDatabase(config.databaseUrl)
  try {
    if (action === "recover") {
      const prompt = createInterface({ input: stdin, output: stdout })
      try {
        const email = await prompt.question("Account email: ")
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
        prompt.close()
      }
    } else {
      if (config.bootstrapMode !== "manual") {
        throw new Error("admin create-owner requires CONDUIT_BOOTSTRAP_MODE=manual")
      }
      const credentials = await readOwnerCredentials()
      const owner = await createOwnerAccount(db, credentials.email, credentials.password)
      console.log(`Created the Conduit owner account for ${owner.email}.`)
    }
  } finally {
    await pool.end()
  }
}

async function readOwnerCredentials(): Promise<{ email: string; password: string }> {
  if (!stdin.isTTY) {
    const input = await readStdin()
    const [email, password] = input.split(/\r?\n/).map((value) => value.trim())
    if (!email || !password) throw new Error("create-owner expects an email and password on separate lines")
    return { email, password }
  }

  const prompt = createInterface({ input: stdin, output: stdout })
  const email = await prompt.question("Owner email: ")
  prompt.close()
  return { email, password: await askSecret("Owner password: ") }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let input = ""
    const onData = (data: Buffer | string) => {
      input += data.toString()
    }
    const onEnd = () => {
      stdin.off("data", onData)
      stdin.off("error", onError)
      resolve(input)
    }
    const onError = (error: Error) => {
      stdin.off("data", onData)
      stdin.off("end", onEnd)
      reject(error)
    }
    stdin.on("data", onData)
    stdin.once("end", onEnd)
    stdin.once("error", onError)
    stdin.resume()
  })
}

async function askSecret(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = ""
    const onData = (data: Buffer) => {
      for (const character of data.toString()) {
        if (character === "\r" || character === "\n") {
          stdin.setRawMode?.(false)
          stdin.off("data", onData)
          stdin.pause()
          stdout.write("\n")
          resolve(value)
        } else if (character === "\u0003") {
          stdin.setRawMode?.(false)
          stdin.off("data", onData)
          stdin.pause()
          reject(new Error("Password entry cancelled"))
        } else if (character === "\u007f") {
          value = value.slice(0, -1)
        } else {
          value += character
        }
      }
    }
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.on("data", onData)
    stdout.write(label)
  })
}
