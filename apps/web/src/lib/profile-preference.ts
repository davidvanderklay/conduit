const LAST_PROFILE_KEY = "conduit.last-profile-id"

export function readLastProfileId(storage: Pick<Storage, "getItem"> = window.localStorage) {
  try {
    return storage.getItem(LAST_PROFILE_KEY) || undefined
  } catch {
    return undefined
  }
}

export function rememberLastProfileId(
  profileId: string,
  storage: Pick<Storage, "setItem"> = window.localStorage,
) {
  try {
    storage.setItem(LAST_PROFILE_KEY, profileId)
  } catch {
    // Profile selection should still work when storage is blocked or full.
  }
}
