# Contributing

## Getting set up

```bash
pnpm install
pnpm build
pnpm test
```

Node 20 or newer and pnpm 9 or newer are required.

## Before you open a pull request

```bash
pnpm typecheck
pnpm test
```

Both run in CI along with a dry run bundle of the Worker. A change that does not
pass locally will not pass there.

## What the review looks for

* New behaviour comes with a test. The callback codec, the segmentation and the
  credential sealing are the parts most likely to break quietly, so changes
  there need coverage.
* Any query that reads or writes business content filters on the business
  identifier inside `packages/runtime/src/db/queries.ts`. Do not add that filter
  in a handler instead.
* Nothing that could contain a credential is logged. That includes bot tokens,
  the master key, the gateway token and full upstream error bodies.
* Command line changes keep the contract described in the README: `--json` on
  every command, no interactive prompts, and a meaningful exit code.

## Commit messages

Write the subject line in the imperative and keep it under seventy two
characters. Explain why the change is needed in the body when the reason is not
obvious from the diff.

## Scope

Version 0.1 targets Cloudflare and Telegram. Proposals that broaden that surface
are welcome as issues for discussion before any code is written.
