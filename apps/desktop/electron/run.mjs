import { spawn } from "node:child_process"

const command = process.env.CONDUIT_ELECTRON_BIN ?? "electron"
const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...environment } = process.env
if (process.platform === "linux") {
  const ozonePlatform = environment.CONDUIT_ELECTRON_OZONE ??
    (environment.WAYLAND_DISPLAY ? "wayland" : "x11")
  environment.NIXOS_OZONE_WL = ozonePlatform === "wayland" ? "1" : "0"
}
const child = spawn(command, process.argv.slice(2), {
  env: environment,
  stdio: "inherit",
})

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
