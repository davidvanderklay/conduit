import { randomBytes } from "node:crypto"
import { tvPage } from "./tv-auth.js"

export const TV_PARTY_HANDOFF_TTL_MS = 5 * 60 * 1000
const MAX_PENDING_HANDOFFS = 2_000
const INVITE_TOKEN = /[A-Za-z0-9_-]{32,100}/

interface Handoff {
  userId: string
  expiresAt: number
  token?: string
}

/** Accepts a bare invitation token or any invitation link ending in one. */
export function inviteTokenFromInput(input: string): string | undefined {
  const path = input.trim().split(/[?#]/)[0] ?? ""
  const candidate = path.split("/").filter(Boolean).at(-1) ?? ""
  return new RegExp(`^${INVITE_TOKEN.source}$`).test(candidate) ? candidate : undefined
}

/**
 * Lets a phone hand a watch-party invitation to a signed-in TV, which cannot
 * paste a link. Requests live in this process, like the party timelines, and
 * each can be filled once and collected once by the account that created it.
 */
export class TvPartyHandoffs {
  private readonly pending = new Map<string, Handoff>()

  start(userId: string, now = Date.now()): { id: string; expiresAt: number } {
    this.prune(now)
    if (this.pending.size >= MAX_PENDING_HANDOFFS) this.pending.delete(this.pending.keys().next().value!)
    const id = randomBytes(32).toString("base64url")
    const expiresAt = now + TV_PARTY_HANDOFF_TTL_MS
    this.pending.set(id, { userId, expiresAt })
    return { id, expiresAt }
  }

  /** True while the request exists and still waits for an invitation. */
  isOpen(id: string, now = Date.now()): boolean {
    const handoff = this.live(id, now)
    return handoff !== undefined && handoff.token === undefined
  }

  submit(id: string, token: string, now = Date.now()): boolean {
    const handoff = this.live(id, now)
    if (!handoff || handoff.token !== undefined) return false
    handoff.token = token
    return true
  }

  /** "pending" until a phone submits, then the token exactly once. */
  collect(id: string, userId: string, now = Date.now()): "expired" | "pending" | { token: string } {
    const handoff = this.live(id, now)
    if (!handoff || handoff.userId !== userId) return "expired"
    if (handoff.token === undefined) return "pending"
    this.pending.delete(id)
    return { token: handoff.token }
  }

  private live(id: string, now: number): Handoff | undefined {
    const handoff = this.pending.get(id)
    if (handoff && handoff.expiresAt <= now) {
      this.pending.delete(id)
      return undefined
    }
    return handoff
  }

  private prune(now: number): void {
    for (const [id, handoff] of this.pending) if (handoff.expiresAt <= now) this.pending.delete(id)
  }
}

export function tvPartyHandoffPage(requestId: string): string {
  return tvPage(
    "Send an invitation to your TV",
    `<h1>Send an invitation to your TV</h1>
<p>Paste the watch party invitation link you received. Your TV joins as soon as you send it.</p>
<input id="invite" autocomplete="off" autocapitalize="off" placeholder="Invitation link" style="width:100%;box-sizing:border-box;height:48px;border-radius:10px;border:1px solid #3f3f46;background:#18181b;color:#fff;font-size:16px;padding:0 12px">
<button id="send">Send to TV</button><p id="status" role="status"></p>
<script>
const button = document.getElementById("send"), input = document.getElementById("invite"), status = document.getElementById("status")
button.addEventListener("click", async () => {
  button.disabled = true
  const response = await fetch("/v1/watch-parties/handoff/" + ${JSON.stringify(requestId)} + "/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invite: input.value }),
  }).catch(() => null)
  if (response && response.ok) { button.remove(); input.remove(); status.textContent = "Sent. Check your TV." }
  else { button.disabled = false; status.textContent = response && response.status === 400 ? "That does not look like an invitation link." : "This request expired. Start again on your TV." }
})
</script>`,
  )
}
