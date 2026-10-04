import assert from "node:assert/strict"
import test from "node:test"
import { mobileBuildNumber, parseReleaseTag, releaseContext } from "./release-context.mjs"

const push = { GITHUB_EVENT_NAME: "push", GITHUB_REF_TYPE: "tag", GITHUB_RUN_NUMBER: "1" }

test("component tags preserve prerelease versions and reject malformed or unsafe inputs", () => {
  assert.deepEqual(parseReleaseTag("android/v0.2.1-alpha.1", "android"), {
    component: "android",
    version: "0.2.1-alpha.1",
    tag: "android/v0.2.1-alpha.1",
    prerelease: true,
  })
  for (const tag of [
    "v0.2.1",
    "android/v0.2.1\n",
    "android/v01.2.1",
    "android/v0.2.1-01",
    "android/v0.2.1-alpha..1",
    "android/v0.2.1\nother=value",
    "android/v0.2.1+build",
    "android/v0.2.1;echo",
  ]) {
    assert.throws(() => parseReleaseTag(tag, "android"), /Invalid component release tag/)
  }
  assert.throws(() => parseReleaseTag("ios/v0.2.1", "android"), /Expected android release/)
})

test("container routing accepts only server and web", () => {
  for (const component of ["server", "web"]) {
    assert.equal(
      releaseContext("container", { ...push, GITHUB_REF_NAME: `${component}/v0.2.0` }).component,
      component,
    )
  }
  assert.throws(() => parseReleaseTag("desktop/v0.2.0", "container"), /Expected container release/)
})

test("manual runs never publish, including runs launched from a tag", () => {
  const manual = { ...push, GITHUB_EVENT_NAME: "workflow_dispatch", RELEASE_TAG: "ios/v0.2.0" }
  assert.equal(releaseContext("ios", manual).publish, "false")
  const preview = releaseContext("ios", { ...manual, RELEASE_TAG: "" })
  assert.equal(preview.version, "0.0.0-ci.1")
  assert.equal(preview.tag, "")
  assert.equal(preview.publish, "false")
  assert.throws(
    () => releaseContext("container", { ...manual, RELEASE_TAG: "" }),
    /require a component tag/,
  )
  assert.throws(
    () => releaseContext("ios", { ...push, GITHUB_REF_TYPE: "branch" }),
    /require a tag push/,
  )
})

test("new mobile counters exceed the legacy 143 and stay within Android's limit", () => {
  assert.equal(mobileBuildNumber("1"), "1000001")
  assert.ok(Number(mobileBuildNumber("1")) > 143)
  assert.ok(Number(mobileBuildNumber("2")) > Number(mobileBuildNumber("1")))
  assert.equal(mobileBuildNumber("2", "2000000"), "2000002")
  for (const [run, offset] of [
    ["0", "1000000"],
    ["1", "-1"],
    ["1", "1.5"],
    ["1", "2100000000"],
    ["not-a-number", "1000000"],
  ]) {
    assert.throws(() => mobileBuildNumber(run, offset))
  }
})
