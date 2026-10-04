import fs from "node:fs"
import { parseReleaseTag } from "./release-context.mjs"

const { component, version } = parseReleaseTag(process.env.RELEASE_TAG, "container")
const pair = JSON.parse(
  fs.readFileSync(new URL("../releases/container-pair.json", import.meta.url), "utf8"),
)
const counterpart = component === "server" ? "web" : "server"
const counterpartVersion = process.env.COUNTERPART_VERSION || pair[counterpart]
parseReleaseTag(`${counterpart}/v${counterpartVersion}`, "container")
const templatePath = new URL("../.env.docker.example", import.meta.url)
const template = fs.readFileSync(templatePath, "utf8")
for (const [name, value] of Object.entries({
  [component]: version,
  [counterpart]: counterpartVersion,
})) {
  const variable = `CONDUIT_${name.toUpperCase()}_VERSION`
  if (!template.includes(`${variable}=`))
    throw new Error(`Missing ${variable} in environment template`)
  pair[name] = value
}
fs.writeFileSync(
  templatePath,
  template
    .replace(/^CONDUIT_SERVER_VERSION=.*$/m, `CONDUIT_SERVER_VERSION=${pair.server}`)
    .replace(/^CONDUIT_WEB_VERSION=.*$/m, `CONDUIT_WEB_VERSION=${pair.web}`),
)
fs.appendFileSync(
  process.env.GITHUB_OUTPUT,
  [
    `counterpart_component=${counterpart}`,
    `counterpart_version=${counterpartVersion}`,
    `test_server_version=${component === "server" ? "ci" : counterpartVersion}`,
    `test_web_version=${component === "web" ? "ci" : counterpartVersion}`,
    "",
  ].join("\n"),
)
