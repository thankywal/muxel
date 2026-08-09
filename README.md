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
* Memory of who it is talking to. Durable facts are distilled from
  conversations, so a returning customer does not have to repeat themselves.
* A customer list with stages, notes and a delete that really deletes.
* Instructions you write yourself, replaced from the console as text or a
  markdown file, with an undo when a change makes things worse.
* Any number of businesses in one deployment, each isolated from the others.

## Before you start

Three things, all free, about six minutes.

1. **Two Telegram bots.** Open [@BotFather](https://t.me/BotFather), send
   `/newbot` twice. One is your private console, the other talks to customers.
   Keep both tokens.
2. **Your Telegram account id.** Send `/start` to
   [@userinfobot](https://t.me/userinfobot). It replies with a number.
3. **A Cloudflare account.** The free plan is enough. No payment method is
   needed, and Muxel does not use any resource that asks for one.

## Deploy from the browser

Click the button above. Cloudflare will ask you to connect GitHub, then walk you
through a setup page. Accept the suggested names for the KV namespace and the
D1 database, then fill in four fields.

**The Vectorize index needs two values that cannot be filled in for you.**
Cloudflare picks them when the index is created and the Worker configuration has
no way to carry them, so the boxes arrive empty:

| Vectorize field | Value    |
| --------------- | -------- |
| Dimensions      | `1024`   |
| Metric          | `cosine` |

Anything else produces an index that silently rejects everything. Setup checks
this and refuses to continue if it is wrong, so a mistake is recoverable, but
getting it right the first time saves deleting the index and starting again.

Then the two secrets:

| Setting             | Value                                      |
| ------------------- | ------------------------------------------ |
| `ADMIN_BOT_TOKEN`   | Console bot token from BotFather           |
| `OWNER_TELEGRAM_ID` | Your number from @userinfobot, digits only |

Everything else provisions itself, including the Telegram webhook: the deploy
step makes the first request to the Worker so it can learn its own address.

When the build finishes, open your console bot and send `/start`.

If the bot stays silent, open the Worker address Cloudflare showed you. That
page runs setup again and says what is wrong.

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

## Instructions and documents are different things

The console keeps them apart because the assistant has to trust them
differently.

| | Instructions | Documents |
| --- | --- | --- |
| Who writes it | you | you, but often from a supplier or a customer |
| How it is treated | rules the assistant follows | facts it may quote |
| Where it goes | the system prompt | inside quoted delimiters |

Instructions are your own text, so they set tone and policy. Documents are
untrusted input, so the assistant is told in advance to read them as data. A
sentence inside a PDF cannot change how the assistant behaves, and the rule
against inventing prices survives whatever your instructions say.

Send a document to the console at any time and it joins the knowledge of
whichever business you last opened. Instructions are replaced explicitly from
the Instructions screen, as a message or a `.md` file, and the previous version
is kept so a bad change can be undone.

## Memory

Facts about a customer are distilled from their conversation every few
messages and stored against their record. A returning customer does not have to
repeat what they bought or how they pay.

Facts live in D1 and are loaded by key rather than embedded and searched. One
person accumulates tens of facts, not thousands, so a single indexed query
returns all of them. That leaves the whole Vectorize allowance for documents,
where semantic search is worth its cost.

The customer screen shows what is remembered, and offers both forgetting the
facts and deleting the person outright.

## Changing the console bot

From the console, open Bots and choose Replace console bot, then send the new
token. The old bot is detached first so the two never answer at once, and the
new one confirms in the same chat.

If you have lost access to the console entirely, change the `ADMIN_BOT_TOKEN`
secret in the Cloudflare dashboard and visit `/setup` again. That path rewrites
the stored credentials as well as the webhook.

## Running costs

Muxel charges nothing, and a small shop fits inside the Cloudflare free plan.

| Resource   | Free allowance                        | What it means here                |
| ---------- | ------------------------------------- | --------------------------------- |
| Workers AI | 10,000 neurons a day                  | about 330 replies a day on Gemma 4 |
| Vectorize  | 5 M stored, 30 M queried dimensions   | about 4,800 chunks of documents   |
| D1         | 5 GB, 100 k row writes a day          | far past what a shop generates    |
| Workers    | 100,000 requests a day                | far past what a shop generates    |

At 1,024 dimensions per vector, the Vectorize storage allowance works out to
roughly 4,800 chunks, which is on the order of a thousand pages of price lists
and policies.

Going past the inference allowance costs 0.011 USD per 1,000 neurons, so the
step beyond free is cents rather than a plan change. Selecting a model from
another provider is the one thing that needs money up front, because you pay
that provider directly.

Muxel deliberately uses no R2 bucket. It would only archive the original of an
uploaded file, which nothing reads back, and enabling R2 requires a payment
method even inside its own free tier. Add a binding named `DOCUMENTS` if you
want originals kept.

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
segmentation, the credential sealing, the memory extraction parser and the
retrieval pipeline are covered by tests, and the pipeline has been run end to
end against a live account. The console has not yet been exercised against a
deployed bot.

## License

Apache 2.0. See [LICENSE](LICENSE).

Muxel is a trademark of the project author. The license grants you the right to
use, modify and redistribute the code. It does not grant the right to use the
Muxel name to identify your own distribution.
