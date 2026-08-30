import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { describe, expect, it } from "vitest"
import { accounts } from "./db/schema.js"

describe("Better Auth account identity", () => {
  it("generates an issuer-scoped account lookup", () => {
    const db = drizzle.mock()
    const query = db
      .select()
      .from(accounts)
      .where(and(eq(accounts.issuer, "https://accounts.google.com"), eq(accounts.accountId, "subject")))
      .toSQL()

    expect(query.sql).toContain('where ("account"."issuer" = $1 and "account"."account_id" = $2)')
  })
})
