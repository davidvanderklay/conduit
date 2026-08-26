export type PowerSaveBlocker = {
  start(type: "prevent-display-sleep"): number
  stop(id: number): void
}

export function createPlaybackInhibitor(blocker: PowerSaveBlocker) {
  let blockerId: number | undefined

  return {
    setPlaying(playing: boolean) {
      if (playing) {
        if (blockerId === undefined) blockerId = blocker.start("prevent-display-sleep")
        return
      }

      if (blockerId !== undefined) {
        blocker.stop(blockerId)
        blockerId = undefined
      }
    },
  }
}
