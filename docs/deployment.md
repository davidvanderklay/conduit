# Deployment and operations

The recommended self-hosted deployment is the published-image Docker Compose
stack. It runs PostgreSQL, the Conduit API, and an Nginx web frontend from one
origin. PostgreSQL is the only application data volume.

## Docker Compose quick start

Download a tagged Compose file and its environment template into any empty
directory. The files have no source checkout or repository-relative paths:

```sh
mkdir conduit && cd conduit
release=v0.1.2-alpha.12
curl --fail --location --remote-name "https://github.com/davidvanderklay/conduit/releases/download/${release}/compose.yaml"
curl --fail --location --remote-name "https://github.com/davidvanderklay/conduit/releases/download/${release}/.env.docker.example"
cp .env.docker.example .env
# Set CONDUIT_VERSION to the downloaded release without the leading v.
```

Edit `.env` before starting. Generate stable values once and keep them backed
up:

```sh
openssl rand -base64 32 # BETTER_AUTH_SECRET
openssl rand -base64 32 # CONDUIT_BOOTSTRAP_TOKEN
openssl rand -hex 32    # ADDON_ENCRYPTION_KEY
openssl rand -hex 32    # POSTGRES_PASSWORD
```

Then start the stack:

```sh
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:8321/health
```

The web container publishes `8321` on `127.0.0.1` by default. Open
`http://localhost:8321` and enter the private `CONDUIT_BOOTSTRAP_TOKEN` to
create the first owner. Migrations run automatically before the API accepts
traffic. The database volume is named `conduit-postgres`.

## Compose settings

The deployment template exposes the settings most operators need:

| Setting | Purpose |
| --- | --- |
| `CONDUIT_VERSION` | Matching API and web image tag. Pin a release for repeatable upgrades. |
| `CONDUIT_URL` | Public browser and authentication origin. |
| `CONDUIT_BIND_ADDRESS` | Host interface for the published web port. Defaults to `127.0.0.1`. |
| `CONDUIT_PORT` | Host web port. Defaults to `8321`. |
| `CONDUIT_BOOTSTRAP_MODE` | `setup-token` for Docker, `manual` for CLI setup, or `first-user` for compatibility. |
| `CONDUIT_BOOTSTRAP_TOKEN` | Required only for `setup-token`; never exposed by `/v1/auth/config`. |
| `POSTGRES_PASSWORD` | Database password. Keep it stable for `conduit-postgres`. |
| `BETTER_AUTH_SECRET` | Session and recovery signing secret. Keep it stable. |
| `ADDON_ENCRYPTION_KEY` | Exactly 64 hexadecimal characters. Keep it stable for encrypted add-ons and OAuth secrets. |

`DATABASE_URL`, `BETTER_AUTH_URL`, and `WEB_ORIGIN` are derived inside the
Compose file. Do not regenerate stable secrets on restart. Losing either
application secret can invalidate sessions or make encrypted configuration
unreadable.

## First-owner bootstrap modes

Docker defaults to `setup-token`. The first account can only be created when the
request includes the token from `.env`; after an owner exists, the token is no
longer accepted. Local registration remains closed unless the owner enables it
in `/admin`.

For a host-only bootstrap with no remotely reachable first-account flow, set:

```env
CONDUIT_BOOTSTRAP_MODE=manual
```

Start the stack, then create the owner from the server container:

```sh
docker compose up -d
docker compose exec server node dist/cli.js admin create-owner
```

The command prompts for an email and hidden password, only works on an empty
database in manual mode, and refuses a repeat invocation after an owner exists.

`first-user` preserves the existing development behavior where the first local
account becomes owner without a token. It is the default when the server runs
outside the deployment Compose file.

The release workflow publishes these public images to GitHub Container Registry:

- `ghcr.io/davidvanderklay/conduit-server`
- `ghcr.io/davidvanderklay/conduit-web`

The first package publication requires the repository owner to make both package
visibility settings public in GitHub. After that one-time action, a new host can
pull the images without a registry login.

## Upgrade and rollback

Back up PostgreSQL, `.env`, and the stable application secrets before upgrading.
Change only the image version, then pull and restart:

```sh
docker compose pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:8321/health
```

Keep `CONDUIT_VERSION` pinned and use a known-good previous tag for an
application rollback. Do not roll binaries back across an irreversible database
migration without restoring a matching database backup.

## Source build for contributors

The root `compose.yaml` is intentionally image-based. Contributors retain the
source-build workflow with the named overlays:

```sh
cp .env.example .env
docker compose -f compose.source.yaml -f compose.dev.yaml up -d postgres
corepack pnpm install --frozen-lockfile
corepack pnpm core:build
corepack pnpm db:migrate
corepack pnpm dev
```

`compose.source.yaml` is a complete source-build companion stack that selects
the `server` and `web` targets from the existing multi-stage Dockerfile;
`compose.dev.yaml` exposes PostgreSQL on the host for local commands. Source
build outputs are `apps/server/dist` and `apps/web/dist`.

## Required persistent data

Back up:

- PostgreSQL, including the `conduit-postgres` volume
- `.env` or the deployment's secret store
- `ADDON_ENCRYPTION_KEY`
- `BETTER_AUTH_SECRET`

Profile exports are useful for user portability, but they do not replace an
instance database backup.

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

## Public demo: Render, Neon, and Cloudflare Pages

This is the supported approximately-$0 demo stack. As of July 30, 2026, Neon
Free includes 0.5 GB storage and 100 compute-hours per project, Cloudflare Pages
Free includes 500 builds per month, and Render provides 750 Free web-service
hours per workspace. A single service needs at most 744 hours in a 31-day month.
Render suspends an idle Free service after 15 minutes and can take about a minute
to wake it. Free tiers are intended for demos rather than availability-sensitive
production.

The architecture has no durable application disk. PostgreSQL is the only durable
state. Browser and desktop clients fetch media directly from media sources.

### 1. Accounts and local CLIs

Create free accounts for [Neon](https://console.neon.tech/),
[Render](https://dashboard.render.com/register), and
[Cloudflare](https://dash.cloudflare.com/sign-up). Do not select a paid Render
instance.

Authenticate the CLIs locally:

```sh
npx neonctl@latest auth
render login
npx wrangler@4 login
```

Install Render from its official CLI release or Homebrew. The other two commands
deliberately use temporary CLI installations so the versions are explicit and
nothing is added to this workspace.

### 2. Neon

Create the project and print its pooled connection string:

```sh
npx neonctl@latest projects create --name conduit-demo
npx neonctl@latest connection-string --project-id <project-id> --pooled
```

Save the project ID and pooled URL in a password manager. The pooled host contains
`-pooler` and the URL must retain `sslmode=require`. Do not put it in a repository
file or shell history. The deployment uses this URL for both migrations and the
API connection pool.

Neon suspends an idle Free compute after about five minutes. The first database
operation after suspension wakes it. A sleeping Render API has the longer cold
start and displays a loading response while it wakes. Retry the client after the
service is awake if its initial eight-second server test times out.

### 3. Cloudflare Pages project

Create the Direct Upload project first so its stable origin can be configured on
the API:

```sh
npx wrangler@4 pages project create conduit-media --production-branch=main
```

The production origin used by this repository is
`https://conduit-media-3cj.pages.dev`. The committed `_redirects` file makes
`/admin` and other client-side routes fall back to the SPA.

### 4. Render API

Generate these values once, store them in a password manager, and never rotate
them merely to redeploy:

```sh
openssl rand -base64 32
openssl rand -hex 32
```

The committed `render.yaml` Blueprint defines a Free Ohio service, `/health`
checks, deploys only after GitHub checks pass, and prompts for values that must
not be committed. In Render, choose **New > Blueprint**, connect this repository,
and enter:

- `DATABASE_URL`: the pooled Neon URL, including `sslmode=require`;
- `BETTER_AUTH_SECRET`: the saved base64 value;
- `ADDON_ENCRYPTION_KEY`: the saved 64-character hexadecimal value; and
- `BETTER_AUTH_URL`: `https://conduit-api.onrender.com` (or the exact hostname
  Render assigns if the name receives a suffix).

The default Docker stage is the API. It runs `node dist/migrate.js` before
Fastify; a failed migration exits the container, so `/health` never admits a
partially migrated deployment. Render has no persistent application disk.

Inspect and operate the service with:

```sh
render services --output json
render logs --resources <service-id> --tail
curl --fail --retry 5 --retry-all-errors --retry-delay 15 https://<api-host>/health
```

### 5. Deploy Cloudflare Pages and configure GitHub

Make the first local deployment:

```sh
VITE_API_URL=https://<api-host> pnpm core:build
VITE_API_URL=https://<api-host> pnpm --filter @conduit/web build
npx wrangler@4 pages deploy apps/web/dist --project-name=conduit-media --branch=main
```

Direct Upload is intentional: the repository workflow owns the build and pins
all build inputs. Cloudflare does not allow a Direct Upload project to be
converted to Git integration later.

Create a Cloudflare API token scoped to **Account / Cloudflare Pages / Edit**,
then configure the repository:

```sh
gh variable set PRODUCTION_API_URL --body 'https://<api-host>'
gh variable set CLOUDFLARE_PAGES_PROJECT --body 'conduit-media'
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set CLOUDFLARE_API_TOKEN
gh workflow run deploy-demo-web.yml
gh run watch
```

The same `PRODUCTION_API_URL` repository variable is compiled into every tagged
desktop release, including the sandboxed Flatpak build. The release workflow
fails rather than accidentally shipping localhost when the variable is absent.
Local development still uses localhost, and users can still choose a different
server. Existing installations that previously saved a custom server keep that
preference until they select the default server again.

There must be no trailing slash in any origin.

### 6. First owner, registration, OAuth, and admin

Open the Pages URL and immediately create the first local account; the first
account becomes the unique instance owner. Registration closes automatically
after that account unless the owner explicitly enables open registration in
`/admin`. Leave it closed for an invitation-only demo.

`/admin` is public as a route but every admin API operation enforces the owner's
server-side role. Render Free does not provide path-specific network isolation,
so role authorization is the primary control on this stack.
Use a strong owner password, store recovery codes offline, and test
`pnpm admin:recover` from a trusted checkout before relying on OAuth alone.

CORS and Better Auth trust exactly `WEB_ORIGIN` plus the packaged Tauri origins.
Credentials are allowed only for those origins. If OAuth is enabled, register:

```text
https://<api-host>/api/auth/callback/google
```

Use the exact callback displayed by `/admin`, keep OAuth auto-registration off
unless public sign-up is intentional, and retain the owner password until
recovery has been tested. Split-origin browser cookies can be affected by user
third-party-cookie policy; desktop bearer authentication is not.

### Operations

Before every upgrade, export both database and secret backups. A database dump
uses Neon's direct (non-pooled) URL:

```sh
pg_dump --format=custom --no-owner --no-acl '<direct-neon-url>' > conduit.dump
pg_restore --clean --if-exists --no-owner --no-acl --dbname '<restore-direct-url>' conduit.dump
```

Restore into a new Neon project or branch first, test it, then update the Render
`DATABASE_URL`. Never test a destructive restore over the only production
database. Neon Free also has a limited restore window, but an external `pg_dump`
is the portable backup.

For an application rollback, choose the previous healthy Render deployment and
Cloudflare Pages deployment in their dashboards or redeploy a known Git commit.
Do not roll application code back across an irreversible schema migration without
restoring its matching database dump. Inspect with:

```sh
render deploys list <service-id>
render logs --resources <service-id>
npx wrangler@4 pages deployment list --project-name=conduit-media
```

Monitor `/health`, Neon storage, Neon compute hours, Render instance type and
workspace hours, and Cloudflare build count. The expected steady-state bill is
$0 only while all resources remain on their named Free tiers.

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
