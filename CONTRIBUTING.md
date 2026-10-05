# Contributing to Conduit

Code, documentation, reproducible bug reports, and device testing are welcome.
Conduit is under active development; the [roadmap](docs/roadmap.md) describes
the current priorities and product scope.

## Find something to work on

- Browse [good first issues](https://github.com/davidvanderklay/conduit/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
  for small tasks with a defined outcome.
- Browse [help wanted](https://github.com/davidvanderklay/conduit/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22help%20wanted%22)
  for work that needs more investigation or platform experience.
- Ask setup questions and discuss ideas in
  [GitHub Discussions](https://github.com/davidvanderklay/conduit/discussions).
- Report ordinary bugs through the [issue forms](https://github.com/davidvanderklay/conduit/issues/new/choose).
  Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

Comment on an issue before starting so other contributors know you're working
on it. Discuss new features, dependencies, schema changes, or substantial UI
changes before implementing them. Small fixes can go straight to a pull request.
Review and replies depend on maintainer availability.

## Set up your checkout

Fork the repository, clone your fork, and create a branch from current `main`.
Follow the [development guide](docs/development.md) for a minimal web/server
setup, tool versions, database migrations, and focused checks. Native mobile
and TV work has a separate [development guide](docs/mobile-development.md).

Use a disposable local database and test accounts. Do not test changes against
production instances or reuse personal credentials. Keep `.env`, add-on URLs
containing credentials, recovery codes, and profile exports out of commits,
screenshots, and logs.

## Keep changes focused

- Solve the issue with the smallest useful change. Avoid unrelated refactors
  and speculative abstractions.
- Preserve type inference and type safety. Avoid TypeScript `any` and casts
  that hide a mismatch.
- Add focused tests for behavior that can break. Documentation-only changes
  need the documentation checks, not a new application test.
- Keep comments and documentation consistent with the implementation.
- Keep media and add-on requests client-to-source. The sync server is not a
  media proxy. Preserve account, household, and profile authorization boundaries.
- Commit generated migration SQL, schema snapshots, and the Drizzle journal
  together. Explain data preservation or backfill work in the PR.

For new UI layouts or substantial copy changes, propose static alternatives
and get a maintainer's choice before editing components. The design direction
is dark mode, a true black background, white primary text, dense layouts, and
minimal copy. Avoid decorative cards and pills, gray subtitle lines above
sections, em dashes, and continuous pulse, shimmer, blur, or spinner animations.

## Open a pull request

1. Rebase your branch onto the latest upstream `main`.
2. Run the checks relevant to your change from the development guides. Include
   the commands and results, plus any checks you could not run.
3. Open a ready-for-review PR. Use a conventional title such as
   `fix(web): preserve manual subtitle selection` or
   `docs: clarify Android setup`.
4. Describe the problem and how your change solves it. Link the issue with
   `Fixes #NUMBER` only when the PR completes it. Include screenshots for UI work.
5. Address review feedback and check CI on your latest commit. Fork PRs should
   work without release signing or deployment secrets; do not request those
   secrets or run publishing workflows for a contribution.

## Test on a device

You can help without building from source. Install a
[published client](docs/installation.md), use your own test instance, and record
the version, OS, device, playback engine, and exact steps. Check sign-in,
browsing, playback, subtitles, seeking, sleep/resume, and progress sync as
relevant. Use a source you have permission to access and redact source tokens.
Post failures as bug reports and broader test results in Discussions.

## Community and licensing

Follow the [code of conduct](CODE_OF_CONDUCT.md). Contributions use the license
of the component they change. Most of the repository is MIT; the Apple mobile
application has a GPLv3 boundary described in the [README](README.md#license).
Check [third-party notices](THIRD_PARTY_NOTICES.md) before adding dependencies,
assets, or media fixtures.
