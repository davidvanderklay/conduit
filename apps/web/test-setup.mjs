import { readFile } from "node:fs/promises"
import { initializeCore } from "./src/lib/core.ts"

const wasm = await readFile("../../packages/core/pkg/conduit_core_bg.wasm")
await initializeCore(wasm)
