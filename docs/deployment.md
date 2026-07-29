# Deployment and operations

Conduit's production packaging is still evolving. The current supported path is
a source build with PostgreSQL, a Node.js API process, and static web assets
served by a web server or CDN.

## Build

```sh
pnpm install --frozen-lockfile
pnpm core:build
pnpm db:migrate
pnpm build
```

Build outputs:

- API: `apps/server/dist`
- Web: `apps/web/dist`
- Desktop artifacts: produced by the Tauri build process

Start the API:

```sh
pnpm --filter @conduit/server start
```

## Required persistent data

Back up:

- PostgreSQL
- `.env` or the deployment's secret store
- `ADDON_ENCRYPTION_KEY`
- `BETTER_AUTH_SECRET`

Losing either encryption/auth secret can make encrypted configuration or
sessions unusable. Keep backups outside the application host.

Run migrations before starting a newly deployed server version:

```sh
pnpm db:migrate
```

## Reverse proxy

Terminate HTTPS at a trusted reverse proxy and forward the API/auth routes to
the server. Preserve the original host and scheme. Configure exact public
origins:

```env
BETTER_AUTH_URL=https://api.conduit.example
WEB_ORIGIN=https://conduit.example
VITE_API_URL=https://api.conduit.example
```

If serving web and API on one host through path routing, ensure every
`/api/auth/*` callback reaches the Conduit server and ordinary SPA routes fall
back to `index.html`.

Restrict `/admin` and `/v1/admin/*` at the reverse proxy or VPN for additional
network isolation. This supplements, rather than replaces, Conduit's server-side
owner authorization.

## OAuth deployment checklist

1. Set the final HTTPS `BETTER_AUTH_URL`.
2. Restart Conduit and copy the callback from `/admin`.
3. Add that exact callback to Google or the OIDC provider.
4. Configure Google branding, audience, production status, and verified domains.
5. Test an existing linked account and a new allowed account.
6. Keep a local owner password until machine-local recovery has been tested.

## Backups

Use PostgreSQL-native backups and test restoration. Encourage users to export
profiles regularly. Database backups recover the instance; profile exports
provide user-controlled portability.

## Machine-local recovery

From the checked-out deployment:

```sh
pnpm admin:recover
```

For a built deployment:

```sh
node apps/server/dist/cli.js admin recover
```

Enter the exact account email when prompted. The CLI never lists the user
directory. Open the printed URL before its ten-minute expiration.

## Health and monitoring

The API health endpoint is:

```text
GET /health
```

Monitor API availability, PostgreSQL health, migration failures, OAuth callback
errors, disk capacity, and backup age. Avoid collecting authentication query
parameters or recovery URLs in long-lived proxy logs.

## Upgrade procedure

1. Back up PostgreSQL and secrets.
2. Fetch the intended release.
3. Install locked dependencies.
4. Build the core, server, and web client.
5. Apply database migrations.
6. Restart the API and static web deployment.
7. Check `/health`, local login, OAuth login, and profile access.

Do not roll back binaries across irreversible migrations without restoring the
matching database backup.
