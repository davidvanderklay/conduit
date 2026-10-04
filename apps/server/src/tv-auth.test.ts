import { describe, expect, it } from "vitest"
import { validateLoopbackCallback, validateMobileCallback } from "./desktop-auth.js"
import { TV_AUTH_CALLBACK, tvAuthApprovalPage, tvUserCode } from "./tv-auth.js"

describe("TV authentication handoff", () => {
  it("derives a stable confirmation code bound to the request and server secret", () => {
    const code = tvUserCode("request-a", "secret")
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/)
    expect(tvUserCode("request-a", "secret")).toBe(code)
    expect(tvUserCode("request-b", "secret")).not.toBe(code)
    expect(tvUserCode("request-a", "other-secret")).not.toBe(code)
  })

  it("cannot be completed through the desktop or mobile redirect handoffs", () => {
    expect(() => validateLoopbackCallback(TV_AUTH_CALLBACK)).toThrow()
    expect(() => validateMobileCallback(TV_AUTH_CALLBACK)).toThrow()
  })

  it("escapes account details on the approval page", () => {
    const html = tvAuthApprovalPage({ requestId: "r".repeat(43), userCode: "ABC-234", email: `"><script>x</script>@example.com` })
    expect(html).not.toContain("<script>x</script>")
    expect(html).toContain("ABC-234")
  })
})
