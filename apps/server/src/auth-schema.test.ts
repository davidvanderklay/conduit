import { mkdtemp, mkdir, readFile, copyFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { hashPassword } from "better-auth/crypto"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildApp } from "./app.js"
import type { Config } from "./config.js"
import { createDatabase } from "./db/index.js"

describe("authentication upgrades", () => {
  let container: StartedPostgreSqlContainer
  let database: ReturnType<typeof createDatabase>
  let baselineFolder: string

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start()
    database = createDatabase(container.getConnectionUri())
    baselineFolder = await mkdtemp(join(tmpdir(), "conduit-auth-upgrade-"))
    await mkdir(join(baselineFolder, "meta"))
    const journal = JSON.parse(await readFile("./drizzle/meta/_journal.json", "utf8")) as {
      entries: { idx: number; tag: string; when: number }[]
    }
    journal.entries = journal.entries.filter((entry) => entry.idx < 19)
    await writeFile(join(baselineFolder, "meta/_journal.json"), JSON.stringify(journal))
    await Promise.all(
      journal.entries.map((entry) =>
        copyFile(`./drizzle/${entry.tag}.sql`, join(baselineFolder, `${entry.tag}.sql`)),
      ),
    )
  }, 120_000)

  beforeEach(async () => {
    await database.pool.query(
      "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public",
    )
  })

  afterAll(async () => {
    await database?.pool.end()
    await container?.stop()
    if (baselineFolder) await rm(baselineFolder, { recursive: true, force: true })
  })

  function config(): Config {
    return {
      databaseUrl: container.getConnectionUri(),
      authSecret: "isolated-auth-test-secret-at-least-32-characters",
      authUrl: "http://localhost:3000",
      addonEncryptionKey: Buffer.alloc(32),
      webOrigin: "http://localhost:5173",
      port: 3000,
      bootstrapMode: "first-user",
      trustProxy: false,
    }
  }

  async function verifyLogin() {
    const app = await buildApp(config(), database.db)
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        payload: { email: "owner@example.com", password: "existing-owner-password" },
      })
      expect(response.statusCode, response.body).toBe(200)
      expect(response.json()).toMatchObject({ user: { id: "owner", role: "owner" } })
    } finally {
      await app.close()
    }
  }

  async function seedExistingAccounts() {
    await database.pool.query(`INSERT INTO "user" (id, name, email, role)
      VALUES ('owner', 'Owner', 'owner@example.com', 'owner')`)
    const password = await hashPassword("existing-owner-password")
    await database.pool.query(
      `INSERT INTO account (id, account_id, provider_id, user_id, password)
      VALUES ('credential', 'owner', 'credential', 'owner', $1),
        ('google', 'google-subject', 'google', 'owner', NULL),
        ('oidc', 'oidc-subject', 'conduit-oidc', 'owner', NULL)`,
      [password],
    )
    // The owner switched providers after linking an OIDC account.
    await database.pool
      .query(`UPDATE instance_setting SET oauth_provider = 'google', oidc_issuer = NULL
      WHERE id = 'default'`)
  }

  it("starts and creates a usable account on a fresh database with the locked auth dependency", async () => {
    await migrate(database.db, { migrationsFolder: "./drizzle" })
    const app = await buildApp(config(), database.db)
    try {
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        payload: { name: "Owner", email: "new@example.com", password: "new-owner-password" },
      })
      expect(signup.statusCode, signup.body).toBe(200)
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        payload: { email: "new@example.com", password: "new-owner-password" },
      })
      expect(login.statusCode, login.body).toBe(200)
      expect(login.json()).toMatchObject({ user: { role: "owner" } })
    } finally {
      await app.close()
    }
  })

  it("upgrades existing credentials and previously linked OIDC accounts after a provider switch", async () => {
    await migrate(database.db, { migrationsFolder: baselineFolder })
    await seedExistingAccounts()
    await migrate(database.db, { migrationsFolder: "./drizzle" })
    const identities = await database.pool.query(
      "SELECT id, account_id, provider_id FROM account ORDER BY id",
    )
    expect(identities.rows).toEqual([
      { id: "credential", account_id: "owner", provider_id: "credential" },
      { id: "google", account_id: "google-subject", provider_id: "google" },
      { id: "oidc", account_id: "oidc-subject", provider_id: "conduit-oidc" },
    ])
    await verifyLogin()
    await expect(
      database.pool.query(`INSERT INTO account (id, account_id, provider_id, user_id)
      VALUES ('duplicate', 'google-subject', 'google', 'owner')`),
    ).rejects.toMatchObject({ code: "23505" })
  })

  it("repairs a database that already applied the required-issuer migration", async () => {
    await migrate(database.db, { migrationsFolder: baselineFolder })
    await seedExistingAccounts()
    // Reproduce the schema and migration journal shipped before this repair.
    await database.pool.query(`ALTER TABLE account ADD COLUMN issuer text;
      UPDATE account SET issuer = CASE provider_id
        WHEN 'credential' THEN 'local:credential'
        WHEN 'google' THEN 'https://accounts.google.com'
        ELSE 'https://id.example/.well-known/openid-configuration' END;
      ALTER TABLE account ALTER COLUMN issuer SET NOT NULL;
      DROP INDEX account_provider_identity_idx;
      CREATE UNIQUE INDEX account_issuer_identity_idx ON account (issuer, account_id);
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES ('previous-issuer-migration', 1788040659210)`)
    await migrate(database.db, { migrationsFolder: "./drizzle" })
    await verifyLogin()
    await expect(
      database.pool.query(`INSERT INTO account (id, account_id, provider_id, user_id)
      VALUES ('duplicate', 'google-subject', 'google', 'owner')`),
    ).rejects.toMatchObject({ code: "23505" })
  })
})
