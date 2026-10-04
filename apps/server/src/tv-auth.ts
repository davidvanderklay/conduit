import { createHash } from "node:crypto"

/**
 * A television cannot receive a browser redirect, so its sign-in request is
 * approved on a phone and collected by polling. This marker distinguishes
 * those requests from desktop and mobile handoffs in the shared table.
 */
export const TV_AUTH_CALLBACK = "conduit-tv://pair"

const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/**
 * A short code shown on both the TV and the approving phone so the viewer can
 * confirm they are approving their own television.
 */
export function tvUserCode(requestId: string, secret: string): string {
  const digest = createHash("sha256").update(`${secret}\0tv-code\0${requestId}`).digest()
  const characters = Array.from(digest.subarray(0, 6), (byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length])
  return `${characters.slice(0, 3).join("")}-${characters.slice(3).join("")}`
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
}

/** Minimal page shell for the phone side of a TV handoff. [body] must already be escaped. */
export function tvPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>
:root{color-scheme:dark}body{margin:0;background:#000;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5}
main{max-width:420px;margin:0 auto;padding:48px 24px}h1{font-size:24px;margin:0 0 12px}p{margin:10px 0;color:#d4d4d8}
.code{font-size:34px;font-weight:700;letter-spacing:.12em;color:#fbbf24;margin:18px 0}
button{width:100%;height:50px;border:0;border-radius:10px;background:#fbbf24;color:#09090b;font-size:16px;font-weight:600;margin-top:14px}
a{color:#fcd34d}</style></head><body><main>${body}</main></body></html>`
}

export function tvAuthMessagePage(title: string, message: string): string {
  return tvPage(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`)
}

/** Asks the signed-in viewer to confirm the code on their TV before the TV receives a session. */
export function tvAuthApprovalPage(input: { requestId: string; userCode: string; email: string }): string {
  return tvPage(
    "Sign in on your TV",
    `<h1>Sign in on your TV</h1>
<p>A TV is asking to sign in as <strong>${escapeHtml(input.email)}</strong>.</p>
<p>Approve only if this code is on your TV screen.</p>
<div class="code">${escapeHtml(input.userCode)}</div>
<button id="approve">Approve</button><p id="status" role="status"></p>
<script>
const button = document.getElementById("approve"), status = document.getElementById("status")
button.addEventListener("click", async () => {
  button.disabled = true
  const response = await fetch("/v1/auth/tv/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ requestId: ${JSON.stringify(input.requestId)} }),
  }).catch(() => null)
  if (response && response.ok) { button.remove(); status.textContent = "Approved. You can return to your TV." }
  else { button.disabled = false; status.textContent = "This request expired. Start again on your TV." }
})
</script>`,
  )
}
