/**
 * Counts episodes that autoplay started since the viewer last clicked, tapped,
 * or pressed a key. Kept in storage because the Electron overlay, which runs
 * the up-next countdown, is a separate window.
 */
const KEY = "conduit.autoplay-streak.v1"
/** Autoplayed episodes after the one the viewer started, so the third episode in a row asks. */
const AUTOPLAYED_EPISODES_BEFORE_ASKING = 2

export function noteAutoplayedEpisode(storage: Storage = localStorage): void {
  storage.setItem(KEY, String(autoplayStreak(storage) + 1))
}

export function noteViewerInput(storage: Storage = localStorage): void {
  if (storage.getItem(KEY) !== null) storage.removeItem(KEY)
}

/** Whether the up-next prompt should ask instead of counting down. */
export function shouldAskStillWatching(enabled: boolean, storage: Storage = localStorage): boolean {
  return enabled && autoplayStreak(storage) >= AUTOPLAYED_EPISODES_BEFORE_ASKING
}

/** Any click, tap, or key press anywhere in the app resets the streak. */
export function trackViewerInput(target: Window = window): void {
  const reset = () => noteViewerInput()
  target.addEventListener("pointerdown", reset, { capture: true, passive: true })
  target.addEventListener("keydown", reset, { capture: true, passive: true })
}

function autoplayStreak(storage: Storage): number {
  const value = Number(storage.getItem(KEY))
  return Number.isInteger(value) && value > 0 ? value : 0
}
