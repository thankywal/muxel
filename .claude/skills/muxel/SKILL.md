---
name: muxel
description: Work on or diagnose a Muxel deployment. Use when someone asks why their Muxel bot is silent, answers wrongly, will not ingest a document, or when changing the runtime, the console or the retrieval pipeline. Covers the Cloudflare API calls that read a live deployment's state.
---

# Muxel

A self hosted customer support agent. It runs entirely inside the operator's own
Cloudflare account: there is no Muxel server, no Muxel database and no account
to sign into. A deployment is a Worker plus D1, KV and Vectorize, driven by a
Telegram console bot.

That shape decides most things. Nothing can be fixed centrally, an operator
cannot be asked to read a dashboard, and a change only reaches anyone who
updates their own copy.

## Layout

| Path | What lives there |
| ---- | ---------------- |
| `packages/runtime/src/index.ts` | Worker entry: `/`, `/setup`, `/health`, `/tg/:path`, cron |
| `packages/runtime/src/telegram/admin.ts` | the console, one screen per action |
| `packages/runtime/src/telegram/reply.ts` | the customer facing path |
| `packages/runtime/src/ai/gateway.ts` | inference, Workers AI binding and gateway |
| `packages/runtime/src/rag/` | chunking, embedding, retrieval, PDF text, ingest |
| `packages/runtime/src/db/migrate.ts` | schema, versioned, applied lazily |
| `packages/core/` | ids, callback encoding, chunking, error taxonomy |

## Rules that are not obvious from the code

- **Migrations are CREATE only.** `ensureSchema` runs a batch then writes the
  version separately. If the batch lands and the version write does not, the
  next run replays it, and `ALTER TABLE` fails on replay. Add a table, not a
  column.
- **Callback data is capped at 64 bytes.** `packages/core/src/callback.ts`
  encodes and spills the overflow into KV. Do not hand roll button payloads.
- **The console bot is not a business bot.** They are separate tables and
  separate webhook paths, so a customer can never reach the console.
- **Thinking is off.** `chat_template_kwargs.enable_thinking: false` on the
  Workers AI path. It is what keeps replies under a second and inside the
  output budget. Removing it brings back empty replies.
- **No R2.** Enabling it demands a payment method, which the product promises
  is unnecessary.
- **Never commit a value into `packages/runtime/src/repo.ts`.** The build
  stamps it per deployment; a committed value points every copy at whoever
  built it last. A test guards this.
- **The update sync must never touch `.github/`.** GitHub rejects any push
  from the default GITHUB_TOKEN that creates or updates a workflow file
  ("refusing to allow a GitHub App ... without `workflows` permission"),
  verified against a live repository. `scripts/update.sh` excludes the
  directory from both the removal and the checkout; widening that breaks every
  operator's updates on their next run. The stub workflow is frozen in
  operator repos for the same reason, so changeable logic belongs only in
  `scripts/update.sh`.

## Reading a live deployment

Everything below is read only and needs a Cloudflare API token with Account
Analytics Read, Workers Scripts Read, D1 Read, Workers Observability Read.
Ask the operator for one rather than guessing at ids.

```bash
CF=<token>; ACC=<account id>
api(){ curl -s -H "Authorization: Bearer $CF" "https://api.cloudflare.com/client/v4/accounts/$ACC/$1"; }

api workers/scripts        # is it deployed, and when
api d1/database            # database uuid
api storage/kv/namespaces
api vectorize/v2/indexes   # must be 1024 dimensions, cosine
```

**Which version is actually running.** A deployment has no link home, so ask
the bundle:

```bash
curl -s -H "Authorization: Bearer $CF" \
  ".../accounts/$ACC/workers/scripts/muxel" -o live.js
grep -oE '"0\.[0-9]+\.[0-9]+"' live.js | sort -u
```

Grep the same file for a marker of the fix in question before believing a
report that it did not work. More than once the answer has been that the
deployment predates the fix.

**Query D1 directly.**

```bash
curl -s -X POST -H "Authorization: Bearer $CF" -H "content-type: application/json" \
  ".../accounts/$ACC/d1/database/$DB/query" -d '{"sql":"SELECT ..."}'
```

Useful ones: `document` for status and chunk counts, `chunk` for what was
actually extracted, `event_log` for failures the operator saw, `message` for
the real conversation, `handover` for chats waiting on a person.

**Measure retrieval rather than reasoning about it.** Embed the customer's
exact question and query the index in their namespace, which is the business
id. Scores below `MIN_SCORE`, currently 0.35, are dropped and the model is told
nothing matched.

**Worker logs.** `POST /accounts/$ACC/workers/observability/telemetry/query`
with `{"parameters":{"datasets":["cloudflare-workers"]},"view":"events"}`.
Look for `waitUntil() tasks ... cancelled`, which means work ran past the
thirty seconds allowed after a response.

## Failure modes already diagnosed

Check these before starting from first principles. Each one presented as
"the bot does not answer" and had a different cause.

| Symptom | Cause | Where |
| ------- | ----- | ----- |
| Says it does not know, right after a document was added | Vectorize makes a write findable about twenty seconds later. Retrieval genuinely matched nothing and the handover was correct. | `rag/ingest.ts` waits and the console says so |
| Empty reply, then an apology | Reasoning model spent the output budget thinking and never wrote anything | budget is 3000 and thinking is off |
| No reply at all, `waitUntil` cancelled | Work ran past thirty seconds. Once from retrying at double budget, once from inserting products one row at a time. | deadline in `reply.ts`, batching in `queries.ts` |
| Asterisks in the reply | Model writes Markdown, Telegram renders none of it | `telegram/format.ts` |
| Reply rejected outright | Model wrote a bare `<`, so Telegram refused to parse the HTML | escape before tagging, plus a plain text retry |
| A PDF became hundreds of junk products | PDF text arrives one fragment per line, nothing like a list | importer refuses input whose lines lack separators |
| Update notice never arrived | The version check cached the upstream file for an hour | no cache override |
| Build red, `/setup` answered 404 on every attempt | A brand new workers.dev address is not routable for a minute or two, and the edge answers 404. The Worker was fine. | `deploy.mjs` records the origin in KV first, waits ~3 min, exits 0 on unreachable; `finishSetup` completes it from cron |
| Deploy reported success, the address answers `Hello world` | Cloudflare's source import failed and pushed only the parsed `wrangler.jsonc`, so no build was ever queued and its placeholder Worker stayed deployed. Not our code: none of it is present. | `docs/DEPLOY-RECOVERY.md`, `scripts/install.mjs` |
| Deploy form throws `ZodError: previews_base_config.deploy_command` on submit | Broken in Cloudflare's dashboard since 2026-08-12, proven by a controlled experiment: the byte-exact tree that imported cleanly on 08-11, a copy with no deploy script, and Cloudflare's own `hello-world-do-template` all fail identically, across three accounts, two GitHub identities and two browsers. Decompiled `cf-ConfigureTemplate` shows the field is filled only from a dashboard form value with a hardcoded default; no repository content reaches it. Do not spend time on repo-side fixes. | `docs/DEPLOY-RECOVERY.md`, `scripts/install.mjs`, memory `muxel-deploy-button-outage` |

Telling the two imports apart, which is the fastest way to settle whether a
failed deploy is ours at all:

| | Good | Failed |
| ---- | ---- | ---- |
| commit author | `cloudflare[bot]` | `cloudflare-workers-and-pages[bot]` |
| commit message | `source repo import` | `Uploading template.` |
| files in the copy | ~95, `.github/` stripped | 2, `README.md` and `wrangler.jsonc` |
| `last_deployed_from` | `wrangler` | `dash_template` |

`gh api repos/OWNER/muxel/commits --jq '.[].commit.message'` answers it in one
call. The older app appears to be reused when it is already installed on the
operator's GitHub account, which is why one account fails repeatedly while a
fresh one succeeds first try. Uninstalling it at
`github.com/settings/installations` is the fix; the hand install is the
guarantee.

## Verifying a change

**Commit to `dev`, never to `main`.** main is the release line every user
consumes: the deploy button clones it, updaters sync it, the version check
reads it. It advances only through the Promote workflow, which fast forwards
it to a dev commit after the full pipeline passed, including a real deploy
into a scratch Cloudflare account (the `smoke` job, `scripts/smoke.mjs`).
A direct push to main skips the one test that has caught every failure that
reached a user, and will also make the next promotion fail its fast forward.

`pnpm typecheck && pnpm test`, then `npx wrangler deploy --dry-run --outdir /tmp/x`
to confirm it still bundles. The smoke test can be run from anywhere with a
Cloudflare token: `CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node
scripts/smoke.mjs`. It creates uniquely named scratch resources and removes
them when it is done.

Bump `VERSION` and `packages/runtime/src/version.ts` together, in the same
commit as anything worth telling operators about. A test enforces that they
match. Docs only changes should not bump, because every bump nags every
deployment.

Commit as the human author, with no assistant attribution.

## Measuring model behaviour

Reasoning length varies enormously between identical calls, so **a single
sample proves nothing**. An earlier attempt at turning thinking off concluded
from one sample per parameter that no switch existed; four samples each showed
one of them working perfectly and the rest being ignored. Run at least five,
and compare distributions rather than single values.

Read the answer from `result.choices[0].message.content`, not
`result.response`, which is the older shape and is absent on chat models.
