import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const users = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    role: text("role").notNull().default("member"),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("single_instance_owner_idx").on(table.role).where(sql`${table.role} = 'owner'`),
  ],
)

export const instanceSettings = pgTable("instance_setting", {
  id: text("id").primaryKey().default("default"),
  registrationMode: text("registration_mode").notNull().default("closed"),
  oauthProvider: text("oauth_provider").notNull().default("google"),
  oidcEnabled: boolean("oidc_enabled").notNull().default(false),
  oidcIssuer: text("oidc_issuer"),
  oidcClientId: text("oidc_client_id"),
  oidcClientSecretEncrypted: text("oidc_client_secret_encrypted"),
  oidcDisplayName: text("oidc_display_name").notNull().default("Single sign-on"),
  oidcScopes: text("oidc_scopes").notNull().default("openid email"),
  oidcAutoRegister: boolean("oidc_auto_register").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const recoveryCodes = pgTable(
  "recovery_code",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [index("recovery_code_user_idx").on(table.userId)],
)

export const adminRecoveryTokens = pgTable(
  "admin_recovery_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("admin_recovery_token_user_idx").on(table.userId)],
)

export const desktopAuthRequests = pgTable(
  "desktop_auth_request",
  {
    id: text("id").primaryKey(),
    callbackUrl: text("callback_url").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeHash: text("code_hash"),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("desktop_auth_request_expiry_idx").on(table.expiresAt),
    index("desktop_auth_request_user_idx").on(table.userId),
  ],
)

export const sessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
)

export const accounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    uniqueIndex("account_provider_identity_idx").on(table.providerId, table.accountId),
  ],
)

export const verifications = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
)

export const rateLimitEntries = pgTable(
  "rate_limit_entry",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("rate_limit_entry_reset_idx").on(table.resetAt)],
)

export const households = pgTable("household", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const householdMembers = pgTable(
  "household_member",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.userId] }),
    index("household_member_user_idx").on(table.userId),
  ],
)

export const profiles = pgTable(
  "profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isKids: boolean("is_kids").notNull().default(false),
    usesPrimaryAddons: boolean("uses_primary_addons").notNull().default(false),
    avatarColor: text("avatar_color"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("profile_household_idx").on(table.householdId)],
)

export const addonInstallations = pgTable(
  "addon_installation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    manifestId: text("manifest_id").notNull(),
    manifestUrlEncrypted: text("manifest_url_encrypted").notNull(),
    manifestUrlHash: text("manifest_url_hash").notNull(),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    position: integer("position").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("addon_profile_url_idx").on(table.profileId, table.manifestUrlHash),
    index("addon_profile_position_idx").on(table.profileId, table.position),
  ],
)

export const watchProgress = pgTable(
  "watch_progress",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    videoId: text("video_id").notNull(),
    mediaType: text("media_type").notNull(),
    mediaId: text("media_id").notNull(),
    name: text("name").notNull(),
    poster: text("poster"),
    videoTitle: text("video_title"),
    season: integer("season"),
    episode: integer("episode"),
    positionMs: integer("position_ms").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    watched: boolean("watched").notNull().default(false),
    dismissed: boolean("dismissed").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.videoId] }),
    index("watch_progress_updated_idx").on(table.profileId, table.updatedAt),
  ],
)

export const libraryItems = pgTable(
  "library_item",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    mediaType: text("media_type").notNull(),
    mediaId: text("media_id").notNull(),
    name: text("name").notNull(),
    poster: text("poster"),
    background: text("background"),
    description: text("description"),
    releaseInfo: text("release_info"),
    runtime: text("runtime"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.mediaType, table.mediaId] }),
    check("library_item_media_type_check", sql`${table.mediaType} in ('movie', 'series')`),
    index("library_item_profile_created_idx").on(table.profileId, table.createdAt),
  ],
)
