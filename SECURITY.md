# Security at Conduit

Conduit is a self-hosted media application that can hold account credentials,
OAuth relationships, encrypted add-on configuration, household membership,
profile data, libraries, and watch history. We take reports about the
confidentiality, integrity, and availability of that data seriously.

Conduit is still under active development. This policy explains how to report
a security issue, what is currently supported, and how operators can keep an
instance safe.

## Report a vulnerability privately

Please do **not** open a public issue, discussion, or pull request for a
vulnerability. Public reports can expose users before a fix is available.

The preferred reporting channel is GitHub's private vulnerability reporting:

**[Report a vulnerability privately](https://github.com/davidvanderklay/conduit/security/advisories/new)**

If GitHub does not show the private reporting form, open a public issue titled
`Security contact request` without including vulnerability details or secrets.
We will use it to establish a private channel.

### What to include

Please include enough information for us to reproduce and assess the report:

- The affected release, commit, client, or deployment configuration
- The feature, endpoint, package, or file involved
- A concise description of the security impact
- Reproduction steps or a minimal proof of concept
- Any prerequisites, such as account role, network position, or configuration
- Logs, screenshots, or request/response samples with credentials and personal
  data removed
- Your preferred name and whether you would like public credit

If you accidentally include a secret, say so immediately and rotate it. Never
send passwords, session cookies, OAuth tokens, recovery codes, database URLs,
encryption keys, or bootstrap tokens in a report.

## What happens after a report

We aim to acknowledge a report within **7 days** and will keep the reporter
updated as the investigation progresses. Response time can vary depending on
severity, reproducibility, and maintainer availability.

For a valid issue, we will:

1. Confirm the affected components and severity.
2. Assess whether users, operators, or third-party services may be affected.
3. Prepare and test a fix or mitigation.
4. Coordinate a release and, where appropriate, a GitHub security advisory.
5. Credit the reporter with their permission.

We ask reporters to allow reasonable time for investigation and remediation
before making technical details public. We do not currently operate a bug
bounty program.

Published advisories, when available, are listed in the repository's
[GitHub security advisories](https://github.com/davidvanderklay/conduit/security/advisories).

## Supported versions

Conduit is pre-release software, so the support window is intentionally simple:

| Version | Security support |
| --- | --- |
| Latest tagged release | Supported |
| Default branch | Supported for reports; may be unstable |
| Older releases | Best effort; upgrade first when possible |

Security fixes are normally developed against the default branch and released
in the next appropriate version. Self-hosted operators are responsible for
tracking releases, applying updates, and reviewing deployment changes.

## Scope

Reports are in scope when they demonstrate a security impact in a supported
Conduit component, including:

- Authentication, sessions, OAuth/OIDC, PKCE, recovery codes, and account
  recovery
- Authorization boundaries between instances, households, profiles, and
  owners
- Exposure or misuse of credentials, encrypted configuration, libraries,
  progress, or other household data
- The Conduit API, web client, desktop client, mobile client, and official
  Docker/deployment configuration
- Vulnerabilities in repository code or dependency integration that can be
  reached through a Conduit installation

The following are generally outside the project's control and should be
reported to the relevant provider instead:

- Vulnerabilities in third-party add-ons, media sources, identity providers,
  hosting platforms, or databases themselves
- Issues that require an already-compromised server, database, device, or
  administrator account, unless they demonstrate a separate privilege or data
  boundary failure
- Denial-of-service testing, spam, social engineering, phishing, or physical
  attacks
- Findings that only concern best-practice hardening without an exploitable
  Conduit security impact

Configuration questions and ordinary bugs are welcome in the normal issue
tracker, but please keep security-sensitive details in a private report.

## Safe research guidelines

Good-faith security research is welcome. To help protect users while testing:

- Test only instances, accounts, and data you own or have explicit permission
  to use.
- Use a local or disposable instance whenever possible.
- Avoid accessing, changing, downloading, or retaining data belonging to other
  users.
- Do not exfiltrate secrets, establish persistence, degrade service, or perform
  high-volume automated testing.
- Stop testing and report promptly if you encounter real user data or a live
  credential.
- Delete copies of any accidentally accessed data after reporting the issue.

We will not pursue action for good-faith research that follows this policy, to
the extent permitted by law. This is not permission to test systems you do not
own, and it does not waive protections for abuse, disruption, or privacy
violations.

## Operator security checklist

For people running Conduit, the most important safeguards are:

- Use HTTPS whenever the server is reachable beyond a trusted local machine.
- Keep the default bind address on localhost unless LAN or router exposure is
  deliberate; use a trusted reverse proxy for public deployments.
- Keep `BETTER_AUTH_SECRET`, `ADDON_ENCRYPTION_KEY`, database credentials,
  OAuth client secrets, and `CONDUIT_BOOTSTRAP_TOKEN` out of source control and
  password-protected backups.
- Treat recovery codes and profile exports as sensitive data, and store them
  separately from the server.
- Back up PostgreSQL and the stable application secrets before upgrades.
- Restrict `/admin` and `/v1/admin/*` at the reverse proxy or VPN when
  practical; this supplements Conduit's server-side authorization.
- Rotate any secret that may have been exposed, then revoke affected sessions
  or OAuth credentials as appropriate.
- Keep Conduit and its deployment images pinned to a known release and update
  when security fixes are published.

See [Authentication and account recovery](docs/authentication.md) and
[Deployment and operations](docs/deployment.md) for the complete recovery,
secret-management, backup, and reverse-proxy guidance.

Thank you for helping keep Conduit and the households that depend on it safe.
