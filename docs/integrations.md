# Trakt, Simkl, and MDBList

Each profile can connect Trakt, Simkl, and MDBList from **Settings > Integrations** in the web or desktop app. Trakt and Simkl show a code to enter on their site. MDBList takes the API key from [mdblist.com/preferences](https://mdblist.com/preferences/).

Once connected, the server keeps the service in step with the profile. Phones and TVs need no setup of their own: their playback and library changes reach the same server.

- **Scrobbling.** Playback starts a scrobble, pauses it about a minute after checkpoints stop, and stops it at 90%, which marks the title watched.
- **History.** Marking episodes or movies watched or unwatched updates the service's history.
- **Watchlist.** Adding a title to the library adds it to the service's watchlist; removing it removes it there. Simkl only receives additions, because its removal endpoint also erases watch history.
- **Import.** Every 15 minutes, and on **Sync now**, the server checks the service for changes. New watched history, watchlist titles, and paused playback are merged into the profile. Paused playback and shows watched in the last 30 days appear in Continue Watching.

Imports only add or advance data. Removing something on the service never deletes it from conduit, and local progress newer than a remote pause wins. Only titles with IMDb ids (the Cinemeta ids most catalogs use) can be matched.

Credentials are encrypted with `ADDON_ENCRYPTION_KEY` and never returned to clients. Disconnecting deletes them from the server.

## Server setup

MDBList works without server configuration. Trakt and Simkl only talk to registered apps, so whoever runs the server registers one app per service and gives conduit its client id. Every profile on the server signs in through that app with its own account. A service without its client id is listed as unavailable.

### Trakt

1. Open [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications) and create an app.
2. Name it anything. Choose **Production** so every Trakt account on your server can sign in; **Development** only admits accounts you add.
3. Set the redirect URI to `urn:ietf:wg:oauth:2.0:oob`. Trakt warns that this URI is insecure but still saves it. conduit never redirects through it; it only repeats it when refreshing tokens. Leave allowed origins empty.
4. Copy the client id into `TRAKT_CLIENT_ID`. Apps created before October 2026 also have a client secret; put it in `TRAKT_CLIENT_SECRET`. Newer apps have none, and the setting stays empty.

### Simkl

1. Open [simkl.com/settings/developer](https://simkl.com/settings/developer/) and create an AUTH V2 app. The "TV, devices & command line" type is enough.
2. Copy the client id into `SIMKL_CLIENT_ID`. conduit does not use the Simkl secret.

### Apply the settings

Add the values to the server's `.env` (or the environment in `compose.yaml`), then restart the server:

```sh
TRAKT_CLIENT_ID=...
TRAKT_CLIENT_SECRET=   # only for older Trakt apps
SIMKL_CLIENT_ID=...
```

The client ids identify the app, not anyone's account. Each profile still signs in from **Settings > Integrations** and gets its own tokens. Upgrading applies migration `0022_integration_connections.sql` with the normal migration command.
