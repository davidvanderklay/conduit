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
same transaction before inserting the archive. A failed transaction leaves the
target unchanged. The target profile ID and household membership are always
retained.

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
