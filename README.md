# Conduit

Conduit is an open-source, self-hosted media application built around
Stremio-compatible add-ons. The server synchronizes households, profiles,
installed add-ons, libraries, and watch progress; clients contact add-ons and
media sources directly.

The project is under active development. Treat current deployments as
pre-release installations and keep profile exports and database backups.

## What Conduit does

- Shared household profiles with independent libraries and watch history
- Stremio-compatible catalogs, metadata, streams, and subtitles
- Web and Tauri desktop clients backed by one shared interface
- Portable profile import/export
- Local password accounts without an email-delivery dependency
- Google OAuth or administrator-configured OpenID Connect
- Recovery codes and machine-local administrator recovery

## Quick development setup

Prerequisites are provided by the Nix flake:

```sh
direnv allow
cp .env.example .env
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres
pnpm install
pnpm core:build
pnpm db:migrate
pnpm dev
```

The web client runs at `http://localhost:5173` and the API server at
`http://localhost:3000`.

See [Development](docs/development.md) for repository structure, individual
commands, tests, database migrations, and desktop requirements.

## Self-hosting with Docker

The provided Compose stack serves the browser client and API from one public
origin:

```sh
cp .env.docker.example .env
# Replace both placeholder secrets in .env, then:
docker compose up -d --build
```

Open `http://localhost:8080`. For a public deployment, set `CONDUIT_URL` to the
final HTTPS URL and place the stack behind a TLS-terminating reverse proxy. See
[Deployment and operations](docs/deployment.md) for configuration and upgrade
details.

## Documentation

- [User and authentication setup](docs/authentication.md)
- [Deployment and operations](docs/deployment.md)
- [Desktop releases](docs/releases.md)
- [Development guide](docs/development.md)
- [Project roadmap](docs/roadmap.md)
- [Portable profile format](docs/portable-profile-format.md)

## Authentication summary

The first account becomes the instance owner. Local registration closes by
default after that account is created. The owner can configure Google directly
or connect a custom OpenID Connect provider from `/admin`.

Users may link OAuth and disable their local password. Before doing that they
should save recovery codes and verify the OAuth login in a separate browser.
An operator with shell access can restore local login without enumerating users:

```sh
pnpm admin:recover
```

The command prompts for one account email and prints a single-use recovery link
that expires after ten minutes. See [Authentication](docs/authentication.md)
for the complete security and recovery model.

## Data and privacy model

Account identities are separate from household profile names. Conduit does not
request a personal name during local registration. Google login requests only
OpenID and email identity scopes.

Configured add-on URLs are encrypted in PostgreSQL. OAuth client secrets are
also encrypted and OAuth tokens are encrypted by Better Auth. Clients fetch
add-on catalogs, metadata, streams, and subtitles directly; the sync server
does not proxy add-on or media traffic.

Profile exports protect portable user data, while recovery codes protect
account access. They solve different problems, and users should keep both.

## Roadmap

The next major client targets are iOS and Android, followed by TV-oriented
experiences including tvOS. Longer-term work includes an optional default
public instance and first-class Jellyfin/Plex integration for unified progress
and library workflows. See the detailed [Roadmap](docs/roadmap.md).

Conduit is intentionally not becoming a general reader or media inbox. YouTube,
RSS, audiobooks, and podcast aggregation are outside the current product scope;
the focus remains a cohesive film and television experience.

## License

Conduit is licensed under the MIT License. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
