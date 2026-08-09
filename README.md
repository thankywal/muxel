# Muxel

Self-hosted AI support agent. Answers your customers on Telegram from your own
price list and policies, running entirely inside your own Cloudflare account.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel)

There is no Muxel server, no Muxel database and no Muxel account. Your
documents, your conversations and your credentials never leave infrastructure
you control.

## What it does

* A console bot you drive entirely with buttons, so no dashboard and no
  configuration files after setup.
* A customer bot per business that answers from your uploaded price lists,
  policies and product information.
* Retrieval grounded replies, so the assistant quotes what your documents say
  instead of inventing an answer, and says so plainly when it does not know.
* Any number of businesses in one deployment, each isolated from the others.

## Before you start

Three things, all free, about six minutes.

1. **Two Telegram bots.** Open [@BotFather](https://t.me/BotFather), send
   `/newbot` twice. One is your private console, the other talks to customers.
   Keep both tokens.
2. **Your Telegram account id.** Send `/start` to
   [@userinfobot](https://t.me/userinfobot). It replies with a number.
3. **A Cloudflare account** on the Workers Paid plan, which is 5 USD a month.
   Vectorize needs it.

## Deploy from the browser

Click the button above. Cloudflare will ask you to connect GitHub, then walk you
through a setup page where you paste:

| Setting             | Value                                     |
| ------------------- | ----------------------------------------- |
| `ADMIN_BOT_TOKEN`   | Console bot token from BotFather          |
| `OWNER_TELEGRAM_ID` | Your number from @userinfobot, digits only |

Everything else provisions itself. When the deploy finishes, open the Worker
address Cloudflare shows you. That first visit is what lets the Worker learn its
own public address and register the Telegram webhook, so do not skip it.

Then open your console bot and send `/start`.

<details>
<summary>After deploying, make your copy private</summary>

Cloudflare clones this repository into your own GitHub account. No business data
ever goes there, because all of it lives in your D1, R2 and Vectorize resources
rather than in files. The clone does end up holding your resource identifiers,
which are not credentials but are not worth publishing either. Set the
repository to private under Settings, Change visibility. Builds keep working.

</details>

## Deploy from a terminal

No GitHub account needed on this path.

```bash
git clone https://github.com/thankywal/muxel.git
cd muxel
pnpm install
pnpm build

npx wrangler login
node packages/cli/dist/index.js doctor

node packages/cli/dist/index.js init \
  --admin-bot-token "<from BotFather>" \
  --owner-telegram-id "<from @userinfobot>" \
  --business "My Shop"
```

`init` provisions the resources, uploads the secrets, deploys and calls the
setup endpoint for you.

## Choosing a model

Every business stores a model string. Changing it is a button press in the
console and needs no redeploy.

| Model             | Cost per 1,000 replies | Needs a provider key |
| ----------------- | ---------------------- | -------------------- |
| Gemma 4 26B       | about 0.33 US cents    | no                   |
| Llama 3.3 70B     | about 0.86 US cents    | no                   |
| GPT-5.6 Luna      | about 0.76 US cents    | yes                  |
| Claude Sonnet 4.5 | varies                 | yes                  |

A Cloudflare login reaches Workers AI models and nothing else. Selecting any
other provider means storing a key in your AI Gateway first, so the console
marks those models rather than letting you pick one that will fail on the first
customer message.

Gemma 4 is the default. Measured on a retrieval reply it costs about a third of
a US cent per thousand answers, and roughly 330 replies a day fall inside the
free daily allowance. Embeddings always run on `bge-m3`, which is multilingual
and effectively free.

## Running costs

Muxel charges nothing. Your Cloudflare bill is the only cost.

Vectorize requires the Workers Paid plan at 5 USD a month. A shop under roughly
three hundred customer messages a day typically stays inside the free inference
allowance on top of that.

## Security

* Business data never leaves your Cloudflare account, and never enters the
  repository. The Worker has no way to write to git.
* Bot tokens are sealed with AES-GCM before they reach the database, so a
  database export on its own yields no usable credential.
* A bot token pasted into the console is deleted from the chat immediately.
* Webhooks are authenticated against a per bot secret using a constant time
  comparison. An unknown path and a bad secret return the same 404, so the
  deployment cannot be probed for valid endpoints.
* The reply path exposes no tools. Retrieved documents are delimited and framed
  as quoted data, so text inside an uploaded file cannot redirect the assistant.
* Every query touching business content filters on the business identifier in
  the data layer rather than in the handlers.

Report a vulnerability through [SECURITY.md](SECURITY.md).

## Development

```bash
pnpm install
pnpm test        # unit tests
pnpm typecheck   # all packages
pnpm build       # packages and a dry run Worker bundle
pnpm dev         # local Worker
```

Layout:

```
wrangler.jsonc      Worker configuration, at the root so one click deploy works
packages/core       types, identifiers, callback codec, text segmentation
packages/runtime    the Worker
packages/cli        the muxel command
```

### Checking the pipeline without Telegram

`scripts/e2e.mjs` runs the whole retrieval path against a real Cloudflare
account with no Worker deployed and no bot connected. It segments the sample
business document in `fixtures/`, embeds it, retrieves against a set of Burmese
questions and prints what each model answered.

```bash
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
node scripts/e2e.mjs --models "workers-ai/@cf/google/gemma-4-26b-a4b-it"
```

The question set includes two answers that must be refusals and one subject the
document says nothing about, so a model that invents an answer fails visibly.

### Command line contract

The command line tool is designed to be driven by scripts and coding agents as
well as people. Every command accepts `--json`, never requires an interactive
terminal, and exits with a code that identifies the failure class rather than a
generic 1. See `muxel help` for the table.

## Status

Version 0.1 targets Cloudflare and Telegram. The callback codec, the
segmentation, the credential sealing and the retrieval pipeline are covered by
tests, and the pipeline has been run end to end against a live account. Adding
knowledge from the console is not wired up yet.

## License

Apache 2.0. See [LICENSE](LICENSE).

Muxel is a trademark of the project author. The license grants you the right to
use, modify and redistribute the code. It does not grant the right to use the
Muxel name to identify your own distribution.
