import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { API_LEVEL, isUpdateTrack, versionTrack, type SystemUpdateStatus } from "@conduit/updates"
import { useUpdates } from "../lib/updates"
import { api } from "../lib/api"
import { API_URL } from "../lib/auth"
import { flushProgressOutbox } from "../lib/progress"

const actionStyle =
  "border border-white px-3 py-2 text-sm text-white hover:bg-white hover:text-black disabled:opacity-50"

export function UpdatesView({
  isOwner,
  accountId,
  restartBlocked = false,
}: {
  isOwner: boolean
  accountId: string
  restartBlocked?: boolean
}) {
  const { desktop, server, count, dismiss } = useUpdates(isOwner, accountId)
  const client = desktop.data
  const queryClient = useQueryClient()
  const [nightlyPrompt, setNightlyPrompt] = useState(false)
  const [instructions, setInstructions] = useState(false)
  const action = useMutation({
    mutationFn: async (
      command: "check" | "download" | "cancel" | "install" | "stable" | "nightly" | "toggle",
    ) => {
      const bridge = window.__CONDUIT_ELECTRON__?.updates
      if (!bridge || !client) throw new Error("Updater unavailable")
      if (command === "install") {
        if (restartBlocked) throw new Error("Leave the watch party before restarting")
        await flushProgressOutbox(accountId)
      }
      if (command === "stable" || command === "nightly" || command === "toggle") {
        await bridge("configure", {
          track: command === "toggle" ? client.track : command,
          enabled: command === "toggle" ? !client.enabled : client.enabled,
        })
      } else await bridge(command, { serverApiLevel: server.data?.apiLevel })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["desktop-updates"] }),
  })
  const serverCheck = useMutation({
    mutationFn: () => api<SystemUpdateStatus>("/v1/admin/updates/check", { method: "POST" }),
    onSuccess: (data) => queryClient.setQueryData(["server-updates", API_URL, isOwner], data),
  })
  const compatible = Boolean(
    server.data && client?.release && server.data.apiLevel >= client.release.minimumApiLevel,
  )
  const legacy =
    server.error?.message.includes("404") || server.error?.message.includes("not found")

  return (
    <main className="mx-auto w-full max-w-4xl bg-black px-5 py-8 text-white">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">Updates</h1>
        {count > 0 && (
          <button className="text-sm underline" onClick={dismiss}>
            Dismiss notice
          </button>
        )}
      </div>
      <section className="mt-7 border-b border-zinc-700 pb-6" aria-label="Client updates">
        <h2 className="text-lg font-semibold">This app</h2>
        {client ? (
          <>
            <p className="mt-2 text-sm">
              {client.installation === "development" ? "Development build" : client.version} ·{" "}
              {client.platform}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-3 text-sm">
                Client track
                <select
                  aria-label="Client update track"
                  className="border border-zinc-600 bg-black px-2 py-1 text-white"
                  value={client.track}
                  disabled={
                    action.isPending ||
                    client.phase === "installing" ||
                    client.installation === "flatpak" ||
                    client.installation === "development"
                  }
                  onChange={(event) => {
                    if (!isUpdateTrack(event.target.value)) return
                    if (event.target.value === "nightly") setNightlyPrompt(true)
                    else action.mutate("stable")
                  }}
                >
                  <option value="stable">Stable</option>
                  <option value="nightly">Nightly</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={client.enabled}
                  disabled={action.isPending || client.installation === "development"}
                  onChange={() => action.mutate("toggle")}
                />
                Check automatically
              </label>
            </div>
            {nightlyPrompt && (
              <div className="mt-4 border-l-2 border-white pl-4" role="alert">
                <p className="text-sm">
                  Nightly builds may break. Switching tracks changes future checks and does not
                  update your server.
                </p>
                <div className="mt-3 flex gap-3">
                  <button
                    className={actionStyle}
                    onClick={() => {
                      setNightlyPrompt(false)
                      action.mutate("nightly")
                    }}
                  >
                    Use Nightly
                  </button>
                  <button className={actionStyle} onClick={() => setNightlyPrompt(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {versionTrack(client.version) === "nightly" &&
              client.track === "stable" &&
              !client.release && (
                <p className="mt-3 text-sm">
                  Installed Nightly, following Stable. Waiting for the next stable release.
                </p>
              )}
            {client.release && (
              <div className="mt-4 text-sm">
                <p>
                  {client.release.version}{" "}
                  {client.installation === "native" ? "available" : "released upstream"}
                </p>
                <a
                  className="mt-2 inline-block underline"
                  href={client.release.notesUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Release notes
                </a>
              </div>
            )}
            {client.phase === "downloading" && (
              <div className="mt-4" role="status">
                <p className="text-sm">Downloading · {Math.round(client.progress ?? 0)}%</p>
                <progress className="mt-2 h-1 w-full" value={client.progress ?? 0} max={100} />
              </div>
            )}
            {client.installation === "native" && client.release && !compatible && (
              <p className="mt-3 text-sm">
                {server.data
                  ? "Update server first. This client requires a newer server API."
                  : "Server compatibility is unknown. Reconnect before downloading."}
              </p>
            )}
            {client.installation === "flatpak" && (
              <p className="mt-3 text-sm">
                Updates and track changes are managed by Flatpak. Use your software manager or{" "}
                <code>
                  flatpak update{" "}
                  {client.track === "nightly"
                    ? "media.conduit.desktop//nightly"
                    : "media.conduit.desktop"}
                </code>
                . Use the same installation scope you installed with.
              </p>
            )}
            {(client.installation === "appimage" || client.installation === "unknown") && (
              <p className="mt-3 text-sm">
                Update using your original installation method. For AppImage, download the matching
                architecture from the release and replace the file after closing Conduit.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                className={actionStyle}
                disabled={
                  action.isPending ||
                  client.phase === "downloading" ||
                  ["ready", "installing"].includes(client.phase) ||
                  client.installation === "development"
                }
                onClick={() => action.mutate("check")}
              >
                {client.phase === "checking" ? "Checking…" : "Check for updates"}
              </button>
              {client.phase === "available" && client.installation === "native" && (
                <button
                  className={actionStyle}
                  disabled={action.isPending || !compatible}
                  onClick={() => action.mutate("download")}
                >
                  Download update
                </button>
              )}
              {client.phase === "downloading" && (
                <button className={actionStyle} onClick={() => action.mutate("cancel")}>
                  Cancel download
                </button>
              )}
              {client.phase === "ready" && (
                <button
                  className={actionStyle}
                  disabled={action.isPending || !compatible || restartBlocked}
                  onClick={() => action.mutate("install")}
                >
                  Restart and update
                </button>
              )}
            </div>
            {client.phase === "installing" && (
              <p className="mt-3 text-sm" role="status">
                Verifying and installing update…
              </p>
            )}
            {client.phase === "ready" && (
              <p className="mt-3 text-sm">
                Ready to install. Close playback and leave any watch party before restarting, or
                keep using the app and update later.
              </p>
            )}
            {client.checkedAt && (
              <p className="mt-3 text-xs text-zinc-400">
                Last successful check {new Date(client.checkedAt).toLocaleString()}
              </p>
            )}
            {client.error && (
              <p className="mt-3 text-sm" role="alert">
                {client.error}
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm">
            {window.__CONDUIT_ELECTRON__
              ? "This client does not support in-app updates yet. Install the latest desktop release manually."
              : `Browser client ${import.meta.env.VITE_RELEASE_VERSION ?? "development"}. Your server owner manages web releases.`}
          </p>
        )}
        {action.error && (
          <p className="mt-3 text-sm" role="alert">
            {action.error.message}
          </p>
        )}
      </section>
      <section className="mt-6" aria-label="Server updates">
        <h2 className="text-lg font-semibold">Connected server</h2>
        {server.data ? (
          <>
            <p className="mt-2 text-sm">
              {server.data.version} · {server.data.track === "nightly" ? "Nightly" : "Stable"}
            </p>
            {server.data.release ? (
              <>
                <p className="mt-3 text-sm">{server.data.release.version} available</p>
                {isOwner ? (
                  <div className="mt-3 flex items-center gap-4">
                    <a
                      className="text-sm underline"
                      href={server.data.release.notesUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Release notes
                    </a>
                    <button className={actionStyle} onClick={() => setInstructions(!instructions)}>
                      Update instructions
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-sm">The server owner can install this update.</p>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm">
                {server.data.error
                  ? "Update availability could not be confirmed."
                  : !server.data.enabled
                    ? "Automatic checks disabled."
                    : server.data.checkedAt
                      ? "No newer release in this track."
                      : "Update check pending."}
              </p>
            )}
            {server.data.apiLevel < API_LEVEL && (
              <p className="mt-3 text-sm" role="alert">
                This server needs an update to support the current client API. Contact its owner.
              </p>
            )}
            {server.data.error && (
              <p className="mt-3 text-sm" role="alert">
                {server.data.error}
              </p>
            )}
            {server.data.checkedAt && (
              <p className="mt-3 text-xs text-zinc-400">
                Last successful check {new Date(server.data.checkedAt).toLocaleString()}
              </p>
            )}
            {isOwner && (
              <button
                className={`${actionStyle} mt-4`}
                disabled={serverCheck.isPending || !server.data.enabled}
                onClick={() => serverCheck.mutate()}
              >
                Check server updates
              </button>
            )}
            {instructions && isOwner && server.data.release && (
              <div className="mt-5 border-t border-zinc-700 pt-4 text-sm">
                <p>
                  Back up PostgreSQL and your configuration. Read the release notes for migration
                  requirements.
                </p>
                <p className="mt-3">
                  In your deployment's .env, set{" "}
                  <code>CONDUIT_SERVER_VERSION={server.data.release.version}</code>. Keep the
                  independent web pin unless compatibility requires its update.
                </p>
                <pre className="mt-3 overflow-auto border-l-2 border-white pl-4">
                  <code>{"docker compose pull server\ndocker compose up -d server"}</code>
                </pre>
                <p className="mt-3">
                  Check health and the running version afterward. Startup runs database migrations.
                  Rolling back an incompatible migration may require restoring your backup. Source
                  installations follow the release's build instructions.
                </p>
                <p className="mt-3">
                  The server's notification track is configured with CONDUIT_UPDATE_TRACK. Changing
                  the client track does not change it.
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm">
            {server.isPending
              ? "Checking server version…"
              : legacy
                ? "This server doesn't report its version."
                : "Couldn't read server update status. Reconnect and try again."}
          </p>
        )}
        {serverCheck.error && (
          <p className="mt-3 text-sm" role="alert">
            {serverCheck.error.message}
          </p>
        )}
      </section>
    </main>
  )
}
