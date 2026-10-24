/** A one-entry M3U playlist that VLC, mpv, IINA, and most other players open. */
export function externalPlaylist(url: string, title: string): string {
  return `#EXTM3U\n#EXTINF:-1,${title.replace(/\s+/g, " ").trim()}\n${url}\n`
}

/** A playlist file name that is safe on Windows, macOS, and Linux. */
export function playlistFileName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|\s]+/g, " ").trim()
  return `${name.slice(0, 120) || "stream"}.m3u`
}

/**
 * Hands a direct stream to a player outside Conduit. The desktop app opens it
 * with the system's default playlist player; browsers download the playlist.
 */
export async function openInExternalPlayer(url: string, title: string): Promise<void> {
  const desktop = window.__CONDUIT_ELECTRON__
  if (desktop?.openInExternalPlayer) return desktop.openInExternalPlayer(url, title)
  const href = URL.createObjectURL(
    new Blob([externalPlaylist(url, title)], { type: "audio/x-mpegurl" }),
  )
  const link = document.createElement("a")
  link.href = href
  link.download = playlistFileName(title)
  link.click()
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(href), 0)
}
