# Muxel

Self-hosted AI support agent. Answers your customers on Telegram from your own
price list and policies, running entirely inside your own Cloudflare account.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel)

New here? Read [Before you start](#before-you-start) first. It is four free
accounts and about ten minutes, and the deploy form asks for two of them.

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

Four things, all free, about ten minutes. None of them asks for a payment card,
and you do not have to write any code at any point.

### 1. A Cloudflare account

This is where Muxel will run, and it is the account that will hold your
documents and conversations. Sign up at
[dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up), then confirm
the email it sends you. Stay on the free plan. Muxel deliberately uses nothing
that asks for a card, so you will not be prompted for one.

Already have an account? Just sign in and move on.

### 2. A GitHub account

Cloudflare keeps a copy of this code under your own name, so it can rebuild your
assistant whenever you update it. Sign up at
[github.com/signup](https://github.com/signup).

You will not need to write anything there. After setup you can close it and
forget about it, apart from the one setting described further down.

### 3. Two Telegram bots

Open [@BotFather](https://t.me/BotFather) in Telegram and send `/newbot`. Do it
twice, because the two bots have different jobs and must never be the same one.

| Bot          | Who writes to it | Name it something like |
| ------------ | ---------------- | ---------------------- |
| Console bot  | only you         | My Muxel Console       |
| Business bot | your customers   | your shop's name       |

Your customers see the business bot's name, so give that one the name of the
shop. BotFather answers each `/newbot` with a long token that looks like
`8012345678:AAH...`. Keep both somewhere you can copy from.

You only need the console bot token to deploy. The business bot token is asked
for later, inside the console.

### 4. Your Telegram account id

Send `/start` to [@userinfobot](https://t.me/userinfobot). It replies with a
number, which is how the console tells you apart from anyone else who finds your
bot. Nobody else can drive it.

## Deploy from the browser

Click the button, or copy this link into your browser:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel)

```
https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel
```

Cloudflare then takes you through three things before the form appears. It asks
you to sign in if you are not already, it asks to connect your GitHub account,
and it asks to install the **Cloudflare Workers and Pages** app on it. Approve
that: it is how Cloudflare creates your copy of the code and rebuilds it when
you update.

On the form, accept the suggested names for the KV namespace and the D1
database, then fill in four fields.

**The Vectorize index asks for two values that cannot be filled in for you.**
They are fixed when the index is created and the Worker configuration has no
field for either, so the boxes arrive empty:

| Vectorize field | Value    |
| --------------- | -------- |
| Dimensions      | `1024`   |
| Metric          | `cosine` |

Getting it wrong is no longer fatal. Embeddings are fitted to whatever the index
was created with, and setup says what the consequence is. A larger number wastes
space and changes nothing, because padding with zeros leaves cosine similarity
exactly as it was. A smaller one shortens embeddings to fit and makes search
less accurate, which is worth correcting but will not stop anything working.

Then the two secrets:

| Setting             | Value                                      |
| ------------------- | ------------------------------------------ |
| `ADMIN_BOT_TOKEN`   | Console bot token from BotFather           |
| `OWNER_TELEGRAM_ID` | Your number from @userinfobot, digits only |

Everything else provisions itself, including the Telegram webhook: the deploy
step makes the first request to the Worker so it can learn its own address.

When the build finishes, open your console bot and send `/start`. That bot is
your private control panel. Add a business there and it will ask for the bot
your customers write to.

If the bot stays silent, open the Worker address Cloudflare showed you. That
page runs setup again and says what is wrong.

<details>
<summary>After deploying, make your copy private</summary>

Cloudflare copies this repository into your own GitHub account, and the copy is
created **public**.

No business data ever goes there. Documents, conversations and customer records
live in D1 and Vectorize, and the Worker has no way to write to git. Secrets are
not written either: they are stored as Worker secrets, and `.dev.vars` is
ignored.

What the copy does hold is the identifiers of the resources in your account,
written into `wrangler.jsonc` during deployment. Those are not credentials and
cannot be used to read anything without your account, but they are not worth
publishing. Set the repository to private under Settings, General, Change
visibility.

The setup page checks this for you and shows a link straight at the setting
while the copy is still public. Acting on it makes the notice disappear, so
there is nothing to remember and nothing to dismiss. Muxel cannot do the change
itself: the repository is created by Cloudflare's GitHub App, the copy arrives
without a `.github` directory so no workflow of ours can run in it, and the
Worker holds no GitHub credential and should not.

Builds keep working after that. Cloudflare reaches your repository as an
installed GitHub App holding `contents: write` on the repositories you granted
it, and an installation's access does not depend on whether a repository is
public.

Only the repository a button is served from has to stay public, which is this
one, not your copy.

</details>

## Staying up to date

Updates are **not** automatic, and it is worth being clear about why.

The deploy button makes an independent copy rather than a GitHub fork, so there
is no Sync fork button and nothing links your copy back here. It also copies
the project **without its `.github` directory**, because the import cannot
create workflow files. Any update workflow shipped in this repository therefore
never arrives in yours.

What does happen on its own: your deployment checks this repository for a newer
version and **messages you in the console bot** when there is one, once per
version. You will not have to remember to look.

### Applying an update

```bash
git clone https://github.com/<you>/muxel.git && cd muxel
git remote add upstream https://github.com/thankywal/muxel.git

# every time, from here on
git fetch upstream
git checkout upstream/main -- .
git checkout HEAD -- wrangler.jsonc      # keeps your resource identifiers
git commit -am "Update from upstream" && git push
```

Pushing triggers your Workers Build, which redeploys and finishes setup. Your
data, settings and bots are untouched.

### Making it automatic

One manual step buys you daily automatic updates from then on. In your copy on
GitHub, choose **Add file**, then **Create new file**, name it
`.github/workflows/update.yml`, and paste
[the workflow from this repository](.github/workflows/update.yml). You can
create workflow files by hand even though the import could not.

Then check **Settings**, **Actions**, **General**, **Workflow permissions** is
set to *Read and write*, or the job cannot push to your own repository.

An update is only applied if the upstream commit's own tests passed, so a broken
commit does not reach a live shop unattended. Run it on demand from the Actions
tab with **Run workflow**.

Your copy tracks upstream, so its history is replaced rather than merged and
local code edits do not survive. Configure through the console instead. If you
intend to change the code, do not add the workflow.

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
  --owner-telegram-id "<from @userinfobot>"
```

`init` provisions the resources, uploads the secrets, deploys and calls the
setup endpoint for you. Businesses are added afterwards from the console, each
with its own bot.

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

## Two kinds of bot

The distinction matters, and the console is built around it.

| | Console bot | Business bot |
| --- | --- | --- |
| Who writes to it | you, alone | your customers |
| What it reaches | every business | exactly one |
| Where it comes from | `ADMIN_BOT_TOKEN` at deploy | created per business in the console |
| Belongs to a business | never | yes, the one it serves |

A business exists because a bot serves it, so the two are created together.
Add business asks for a bot token rather than a name, and the bot's own name
becomes the business name. There is no step where a business sits waiting for a
bot, and no way to attach the console bot to a business: the console refuses its
own token.

## The console

Everything after setup happens in the console bot, in buttons.

| Screen | What it holds |
| --- | --- |
| Data | Uploaded files, one row each, with a delete on every one |
| Products | Items typed in one at a time or uploaded in bulk |
| Customers | Everyone who has written, with stages, notes and memory |
| Instructions | Your own rules for the assistant, with an undo |
| Bots | The business bots customers write to, and adding another |

Data accepts PDF, Word, Excel, CSV, TXT, Markdown, JSON and JSONL. Text formats
are read directly. Spreadsheets and documents go through the platform
converter, and a PDF it cannot read is retried against the text layer, which is
what makes a price list exported from Excel work.

A file has to belong to a business, so the console asks you to open one before
it will accept an upload rather than guessing.

Products exist alongside files because a file can only be replaced whole. A
price that changes should not mean re-uploading a catalogue. Products are
entered as `name | price | description`, one per line, typed in or uploaded, and
each can be removed on its own. Every change rebuilds what the assistant knows.

Deleting a business asks for confirmation and then removes its files, products,
customers, bots and vectors together.

### Languages

The console speaks English, ไทย, 中文 and မြန်မာ. Language is per operator and
changes every button, not only the next screen. It is separate from the language
a business replies to customers in.

## When the assistant should not answer

The assistant answers from the documents you gave it. Some questions are not in
them: a discount nobody wrote down, a complaint, a special order. Guessing at
those is the failure that loses a customer, so it does not.

Instead it tells the customer that someone will follow up, and tells you. The
alert arrives in the console with a button that opens the conversation.

From a customer's screen in the console:

| Action                        | What happens                                            |
| ----------------------------- | ------------------------------------------------------- |
| **Conversation**              | the full transcript, marked by who said each line        |
| **Take over**                 | the assistant goes quiet in that chat                    |
| **Send a message**            | you type, the customer receives it from the business bot |
| **Give back to the assistant**| it resumes answering                                     |

While you are answering, the assistant stays out of the way and forwards
anything the customer writes, so two voices never reply to the same person. A
message you send is recorded as part of the conversation, which means the
assistant has read it if you hand the chat back.

**Waiting for a person** on the console home lists every chat that needs you,
across all your businesses.

A question the assistant could not answer does not mute it for the rest of the
chat. It keeps answering everything else, because going silent after one hard
question would be worse than the question.

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

### Seeing what you have used

The console has a **Usage** screen. Without any configuration it reports what
this deployment has answered today and the tokens that took, because Muxel
counts those itself.

The account totals are a different question, since your other Workers draw on
the same allowance, and only Cloudflare can answer it. To show them, create an
API token with **Account Analytics: Read** and nothing else, then add two
secrets to the Worker under Settings, Variables and Secrets:

| Secret          | Value                                    |
| --------------- | ---------------------------------------- |
| `CF_ACCOUNT_ID` | your account id, from the dashboard URL  |
| `CF_API_TOKEN`  | the read only token you just created     |

The screen then shows neurons used today against the daily allowance, a
breakdown per model, Worker requests, Vectorize search and storage, and an
estimate of how many more replies today's allowance covers. That estimate comes
from what your own replies actually cost rather than from a published rate, so
it stays accurate if you change model.

The token is read only. It cannot deploy, change configuration or read your
data, and Muxel never displays it.

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
