# Portable profile format

Conduit profile exports are UTF-8 JSON documents. The top-level `format` is
`"conduit-profile"` and `version` is currently `1`. Importers accept versions
they understand, migrate older versions when migrations exist, and reject newer
versions rather than guessing.

Version 1 contains:

- `profile`: display name and kids-profile setting.
- `preferences`: optional device playback and appearance settings, added by the client.
- `library`: cached movie and series metadata, including original timestamps.
- `progress`: watch progress, watched state, and history timestamps.
- `addons`: manifest snapshots, enabled state, and order.

By default, `addons[].manifestUrl` is omitted because configured URLs can carry
API keys or other credentials. A user can explicitly include those URLs while
exporting to make the add-ons transferable. Such an export should be handled
like a password backup. Server encryption keys, account records, password
hashes, sessions, household memberships, and data from other profiles are never
part of this format.

Imports are limited to 10 MiB and 10,000 entries per section. Conduit validates
the complete document, identifiers, timestamps, URLs, duplicates, and field
sizes before opening the write transaction. The preview endpoint performs no
writes. `merge` upserts archive entries and retains unrelated local entries;
`replace` deletes the target profile's library, progress, and add-ons inside the
same transaction before inserting the archive. `additive` never overwrites:
it inserts missing library titles, updates progress only where the archive
entry is newer, skips add-ons whose manifest ID is already installed, appends
new add-ons after existing ones, and keeps the profile name and kids setting.
A failed transaction leaves the target unchanged. The target profile ID and
household membership are always retained.

## Migrating from Stremio or Nuvio

Settings > Your data > Migrate reads a Stremio account or a Nuvio profile and
imports it with `additive`. The server endpoints are:

- `POST /v1/migrations/connect` signs in with Stremio email and password,
  a Stremio auth key, or Nuvio email and password. Nuvio defaults to
  `https://api.nuvio.tv`; self-hosted Nuvio servers are found through
  `<server>/.well-known/nuvio`. It returns a session and the source profiles.
- `POST /v1/migrations/read` returns a `conduit-profile` document with counts
  and warnings. Clients may drop sections before sending it to
  `/v1/profiles/:profileId/import`.

Credentials and session tokens are forwarded for one request and never stored.
Nothing is written to Stremio or Nuvio. The source is read for library titles,
Continue Watching progress, watched movies and episodes, and add-ons. Stremio
episode history is decoded against Cinemeta's episode list, so it is available
for IMDb-identified series. Nuvio add-on manifests are fetched by the server
over HTTPS.

## Example fixture

```json
{
  "format": "conduit-profile",
  "version": 1,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "profile": { "name": "Main", "isKids": false },
  "preferences": { "audioLanguage": "auto", "theme": "dark" },
  "library": [{
    "mediaType": "movie",
    "mediaId": "tt123",
    "name": "Example",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-02T00:00:00.000Z"
  }],
  "progress": [{
    "videoId": "tt123",
    "mediaType": "movie",
    "mediaId": "tt123",
    "name": "Example",
    "positionMs": 42000,
    "durationMs": 100000,
    "watched": false,
    "updatedAt": "2025-01-02T00:00:00.000Z"
  }],
  "addons": [{
    "manifestId": "org.example",
    "manifest": { "id": "org.example", "name": "Example" },
    "position": 0,
    "enabled": true
  }]
}
```
