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

MDBList works without server configuration. Trakt and Simkl need an app registered by the server operator:

| Service | Register at                                                                                                                                    | Settings                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Trakt   | [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications). Use `urn:ietf:wg:oauth:2.0:oob` as the redirect URI.                       | `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET` |
| Simkl   | [simkl.com/settings/developer](https://simkl.com/settings/developer/). Choose an AUTH V2 app; the "TV, devices & command line" type is enough. | `SIMKL_CLIENT_ID`                        |

A service without its settings is listed as unavailable. Apply migration `0022_integration_connections.sql` with the normal migration command.
