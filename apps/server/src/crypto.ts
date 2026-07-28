import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"

export function encryptSecret(value: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".")
}

export function decryptSecret(value: string, key: Buffer): string {
  const parts = value.split(".")
  if (parts.length !== 3) {
    throw new Error("invalid encrypted value")
  }
  const [ivValue, tagValue, encryptedValue] = parts
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivValue!, "base64url"))
  decipher.setAuthTag(Buffer.from(tagValue!, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue!, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

export function stableSecretHash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
