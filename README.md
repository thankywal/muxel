# Muxel

Deploy an AI business backend into your own Cloudflare account.

Muxel provisions a complete customer service runtime inside infrastructure you
already own. Your documents, your conversations and your credentials stay in
your Cloudflare account. There is no Muxel server, no Muxel database and no
account to create.

## What it does

You give Muxel a Cloudflare login and a Telegram bot. It gives you a business
assistant that answers customers from your own documents.

* A console bot that you drive entirely with buttons, so no dashboard and no
  configuration files are needed after setup.
* A customer bot per business that answers questions using your uploaded price
  lists, policies and product information.
* Retrieval grounded replies, so the assistant quotes what your documents say
  instead of inventing an answer.
* Any number of businesses in one deployment, each isolated from the others.

## How it works

```
  npx muxel init
        |
        v
  your Cloudflare account
        |
        +--  Worker         request handling and inference
        +--  D1             businesses, bots, documents, transcripts
        +--  R2             original uploaded files
        +--  Vectorize      embeddings, one namespace per business
        +--  KV             menu state and short lived tokens
        +--  Workers AI     embeddings
```

Muxel itself never sees any of it. The command line tool talks to the
Cloudflare API with your credentials and then exits.

## Quick start

You need Node 20 or newer, a Cloudflare account on the Workers Paid plan and a
bot token from [@BotFather](https://t.me/BotFather).

```bash
git clone https://github.com/thankywal/muxel.git
cd muxel
pnpm install
pnpm build

npx wrangler login
node packages/cli/dist/index.js doctor
```

Provision and deploy from the runtime package:

```bash
node packages/cli/dist/index.js init \
  --dir packages/runtime \
  --gateway-token "$AI_GATEWAY_TOKEN"
```

Take ownership of the console. The code is single use and proves that you
control the Telegram account, which a number typed into a form does not:

```bash
node packages/cli/dist/index.js claim --dir packages/runtime
```

Send the printed `/claim` command to your console bot. The console opens and
everything after that is buttons.

## What gets created

`muxel init` creates the following in your account and writes their identifiers
into `packages/runtime/wrangler.jsonc`:

| Resource  | Name              | Holds                                  |
| --------- | ----------------- | -------------------------------------- |
| D1        | `muxel`           | Businesses, bots, documents, messages   |
| R2        | `muxel-documents` | Original uploaded files                 |
| Vectorize | `muxel-knowledge` | Embeddings, one namespace per business  |
| KV        | `STATE`           | Menu state, claim codes, spilled menus  |

Three secrets are uploaded: a master key that encrypts bot tokens, your account
identifier and your gateway token. Creating a resource that already exists is
reported as reused, so an interrupted run can be repeated safely.

## Choosing a model

Every business stores a model string that is passed to the AI Gateway
compatibility endpoint. Changing the model is a button press in the console and
requires no redeploy.

Embeddings always run on Workers AI. The daily neuron allowance covers a very
large volume of embedding work, so paying an external provider for it would be
waste. Reply generation is where quality matters, so that call is routed
wherever you point it.

## Security

* Business data never leaves your Cloudflare account.
* Bot tokens are sealed with AES-GCM before they reach the database. A database
  export on its own yields no usable credential.
* A bot token pasted into the console is deleted from the chat immediately.
* Every webhook is authenticated against a per bot secret using a constant time
  comparison. An unknown path and a bad secret return the same 404, so the
  deployment cannot be probed for valid endpoints.
* The reply path exposes no tools. Retrieved documents are delimited and framed
  as quoted data, so text inside an uploaded file cannot redirect the assistant.
* Every query that touches business content filters on the business identifier
  in the data layer rather than in the handlers.

Report a vulnerability through [SECURITY.md](SECURITY.md).

## Running costs

Muxel charges nothing. Your Cloudflare bill is the only cost.

Vectorize requires the Workers Paid plan, which is 5 USD per month. Workers AI
includes a daily free allowance that covers embedding comfortably and a modest
number of replies. A shop under roughly eighty customer messages per day
typically stays inside that allowance.

## Development

```bash
pnpm install
pnpm test        # unit tests
pnpm typecheck   # all packages
pnpm build       # core and cli
```

Layout:

```
packages/core       types, identifiers, callback codec
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
If the token cannot reach Vectorize the run falls back to an exact local cosine
search and says so, which keeps it usable on a token that only carries Workers
AI permissions.

### Command line contract

The command line tool is designed to be driven by scripts and coding agents as
well as people. Every command accepts `--json`, never requires an interactive
terminal, and exits with a code that identifies the failure class rather than a
generic 1. See `muxel help` for the table.

## Status

Version 0.1 targets Cloudflare and Telegram. The core, the callback codec, the
segmentation and the credential sealing are covered by tests. Provisioning has
not yet been exercised against a wide range of account configurations, so treat
`init` as early and read what it prints.

## License

Apache 2.0. See [LICENSE](LICENSE).

Muxel is a trademark of the project author. The license grants you the right to
use, modify and redistribute the code. It does not grant the right to use the
Muxel name to identify your own distribution.
