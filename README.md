# Conduit

Conduit is an open-source, self-hostable media system built around a shared
client engine. Clients contact Stremio-compatible add-ons directly, while a
Conduit server synchronizes household state, profiles, configured add-ons,
libraries, and watch progress.

## Development

Prerequisites are supplied by Nix:

```sh
direnv allow
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm core:build
pnpm db:migrate
pnpm dev
```

The web client runs at `http://localhost:5173` and the sync server at
`http://localhost:3000`.

Configured add-on URLs are encrypted in PostgreSQL and synchronized to
authorized household clients. Clients fetch add-on catalogs, metadata, streams,
and subtitles directly; the sync server does not proxy add-on or media traffic.
