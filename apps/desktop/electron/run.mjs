import { spawn } from "node:child_process"

const command = process.env.CONDUIT_ELECTRON_BIN ?? "electron"
const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...environment } = process.env
const appArguments = process.argv.slice(2)
if (process.platform === "linux") {
  const ozonePlatform = environment.CONDUIT_ELECTRON_OZONE ??
    (environment.WAYLAND_DISPLAY ? "wayland" : "x11")
  environment.NIXOS_OZONE_WL = ozonePlatform === "wayland" ? "1" : "0"

  const electronSwitches = [`--ozone-platform=${ozonePlatform}`]
  if (ozonePlatform === "x11") {
    electronSwitches.push("--enable-transparent-visuals")
  }
  if (environment.CONDUIT_ELECTRON_IN_PROCESS_GPU === "1") {
    electronSwitches.push("--in-process-gpu")
  } else if (environment.CONDUIT_ELECTRON_DISABLE_GPU === "1") {
    electronSwitches.push("--disable-gpu")
  }
  appArguments.unshift(...electronSwitches)
}
const child = spawn(command, appArguments, {
  env: environment,
  stdio: "inherit",
})

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
