# Deployment and operations

The recommended self-hosted deployment is the provided Docker Compose stack. It
runs PostgreSQL, the Node.js API, and an Nginx web frontend. Nginx serves the SPA
and proxies API requests, so users only connect to one public origin.

## Docker Compose

Copy the deployment environment template and replace both generated secrets:

```sh
cp .env.docker.example .env
openssl rand -base64 32
openssl rand -hex 32
docker compose up -d --build
```

The defaults serve Conduit at `http://localhost:8080`. A public deployment
normally changes only:

```env
CONDUIT_URL=https://conduit.example
CONDUIT_PORT=8080
BETTER_AUTH_SECRET=<output of openssl rand -base64 32>
ADDON_ENCRYPTION_KEY=<output of openssl rand -hex 32>
```

`CONDUIT_URL` configures both the browser origin and Better Auth's external URL.
The browser uses the origin it loaded from as its default API, so no separate
frontend API setting is required. Only the web container publishes a host port;
the API and PostgreSQL remain on the Compose network. Database migrations run
automatically before the API starts.

Terminate HTTPS at a reverse proxy and forward it to `CONDUIT_PORT`. Preserve
the original host and scheme. OAuth callbacks use
`$CONDUIT_URL/api/auth/callback/...`.

Upgrade with:

```sh
docker compose pull
docker compose up -d --build
docker compose ps
```

Back up the `conduit-postgres` volume and `.env` before upgrading.

## Source build

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

## Separate frontend and API deployments

Terminate HTTPS at a trusted reverse proxy and forward the API/auth routes to
the server. Preserve the original host and scheme. Configure exact public
origins:

```env
BETTER_AUTH_URL=https://api.conduit.example
WEB_ORIGIN=https://conduit.example
VITE_API_URL=https://api.conduit.example
```

`VITE_API_URL` is compiled into a client as its **default server** when set. If
it is omitted, a browser build uses its own origin and a packaged desktop build
falls back to `http://localhost:3000`. Users can choose **Change server** on the
sign-in screen. That selection is stored only on their device and takes effect
after reload.

Custom servers must:

- expose `GET /health` and the Conduit API over a URL reachable by the client;
- use HTTPS outside local development;
- set `BETTER_AUTH_URL` to that externally reachable API URL; and
- allow the distributed client's origin with `WEB_ORIGIN`.

For the browser client, normal CORS, mixed-content, cookie, and third-party
cookie rules still apply. The most reliable web deployment serves the web
client and API on the same site. The server picker is primarily intended for
packaged desktop/mobile clients and compatible web deployments; it is not a
proxy and does not bypass browser security controls.

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

Packaged desktop clients use the same provider callback shown in `/admin`; no
desktop callback needs to be added to Google or the OIDC provider. The browser
returns to a temporary `127.0.0.1` port only after the Conduit server has
processed the provider callback. Host firewalls must permit the Conduit process
to accept a local loopback connection.

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
