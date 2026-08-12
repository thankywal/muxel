**English** · [မြန်မာ](README.my.md) · [ไทย](README.th.md) · [日本語](README.ja.md) · [中文](README.zh.md)

# Muxel

Self-hosted AI support agent. Answers your customers on Telegram from your own
price list and policies, running entirely inside your own Cloudflare account.

> **The one click deploy is broken at Cloudflare's end right now, 12 August
> 2026.** Pressing Deploy on their setup form throws
> `ZodError: previews_base_config.deploy_command` and stops, leaving a
> repository holding two files and a Worker answering `Hello world`, while the
> dashboard reports success. It is not something this project can fix: the
> field it rejects belongs to a build setting that
> [Cloudflare's own documentation](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
> says cannot be set from a repository. The same commit that deployed cleanly
> on 11 August fails today, unchanged, and Cloudflare's own
> `hello-world-do-template` fails with the identical error on two unrelated
> accounts, so the flow is broken for every repository, not this one. Reported
> to Cloudflare as
> [workers-sdk#15147](https://github.com/cloudflare/workers-sdk/issues/15147),
> where you can watch for the fix.
>
> Install with [docs/DEPLOY-RECOVERY.md](docs/DEPLOY-RECOVERY.md) instead. It
> takes one command, skips GitHub entirely, and produces exactly the same
> deployment. This notice will go once the button works again.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel)

New here? Read [Before you start](#before-you-start) first. It is four free
accounts and about ten minutes, and the deploy form asks for two of them.

Helping someone else set this up over chat? The same steps are written as a
single sendable message, in five languages, in
[docs/TELEGRAM-SETUP.md](docs/TELEGRAM-SETUP.md).

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
* A chat bubble for your own website, generated from the console, sharing the
  same documents, customer list and handover queue as Telegram.
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
and it asks to install its GitHub app on it. Approve that: it is how Cloudflare
creates your copy of the code and rebuilds it when you update.

If your GitHub account already has an app called **Cloudflare Workers and
Pages** from an earlier project, remove it first at
[github.com/settings/installations](https://github.com/settings/installations)
and let this flow install the current one. The older app can copy the
repository incompletely, which produces a deploy that reports success and
serves nothing. [docs/DEPLOY-RECOVERY.md](docs/DEPLOY-RECOVERY.md) covers it.

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

**If that address answers `Hello world`, the deploy did not finish.** Cloudflare
copies this repository into your GitHub account before building it, and that
copy occasionally fails while the dashboard still reports success. It leaves a
placeholder Worker behind, so no part of Muxel is running and nothing can report
the problem to you. [docs/DEPLOY-RECOVERY.md](docs/DEPLOY-RECOVERY.md) tells you
how to confirm it and gives two ways to finish the install, one of which does
not involve GitHub at all.

A brand new `workers.dev` address is not reachable for the first minute or two,
so the deploy log may end with **the address is not serving yet**. Nothing is
broken: the Worker is live, it has recorded where it lives, and it finishes
connecting itself within fifteen minutes. Opening the address does it at once.

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

Three clicks, once, on your Worker's setup page. Open the page and find
**Automatic updates**:

1. **Add the update workflow.** The link opens GitHub with the file already
   filled in; you only press **Commit changes**. Nothing can commit it for
   you: GitHub does not let the deploy flow's app create workflow files, which
   is also why the import arrived without any.
2. **Allow it to write.** Under **Workflow permissions** choose *Read and
   write*. This is a repository setting, and GitHub lets nobody set it from a
   link.
3. **Run it once** with **Run workflow**.

From then on updates arrive daily on their own, and the update notice in your
console carries a **Run the update now** button for the days you do not want
to wait.

The pasted file is a stub that never changes. The logic it runs lives in
`scripts/update.sh`, which travels with every update like any other code, so a
fix to the updater itself reaches you without anyone pasting anything again.

An update is applied only when the upstream commit's own tests passed, only
after the fetched tree has been checked for the files Muxel cannot exist
without, and never touches your `wrangler.jsonc` or your `.github` folder.

Your copy tracks upstream, so local code edits do not survive an update.
Configure through the console instead. If you intend to change the code, do
not add the workflow.

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
| Products | What your data offers, read out by the assistant |
| Customers | Everyone who has written, with stages, notes and memory |
| Instructions | Your own rules for the assistant, with an undo |
| Bots | The business bots customers write to, and adding another |

Data accepts PDF, Word, Excel, CSV, TXT, Markdown, JSON and JSONL. Text formats
are read directly. Spreadsheets and documents go through the platform
converter, and a PDF it cannot read is retried against the text layer, which is
what makes a price list exported from Excel work.

A file has to belong to a business, so the console asks you to open one before
it will accept an upload rather than guessing.

Products are not a second list you maintain. When a file is added, the
assistant reads it once and the Products screen shows what it found: each item,
its price, and the file it came from. Your data stays the single source of
truth, and the screen is a window onto it.

A price that changes should not mean re-uploading a catalogue, so every item
can be corrected from its own page. A correction is stored as an owner update,
a small document of its own, which the assistant is told outranks anything
older. The same works in reverse: mark an item **No longer sold** and the
assistant says so, whatever the original file still claims. To take a
correction back, or after replacing a file wholesale, press **Re-read from
data**.

An item can also be typed in as `name | price | description` when there is no
file to read it from. It travels the same road: it becomes part of the owner
updates document, and the assistant learns it like anything else you uploaded.

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

The alert and the transcript both name the customer with their Telegram
username, `Ma Ma (@mama_shop)`, because a display name is whatever someone
typed into their profile and cannot be used to reach them.

Every line carries its date as well as its time. A transcript spans days, and
a time on its own reads as today.

**Photos, videos, stickers, voice notes and files are kept too.** A photo with
no caption is not something the assistant should guess at, so it goes straight
to you rather than being answered. Attachments appear as buttons under the
transcript; tapping one sends it into your chat. Nothing is stored: the console
asks the business bot for a temporary link at the moment you look, so
attachments older than a few months may be gone from Telegram's side.

**Waiting for a person** on the console home lists every chat that needs you,
across all your businesses.

A question the assistant could not answer does not mute it for the rest of the
chat. It keeps answering everything else, because going silent after one hard
question would be worse than the question.

## Your own website

The same assistant can answer on your site as well as on Telegram. In the
console, open a business and choose **Web agent**, then **Generate web agent**.

You get two things. The first is a link on your own Worker address that is
nothing but the widget, so you can press the bubble and hold the conversation a
visitor will have before it goes anywhere near your site. The second is one
line to paste into your website, just before `</body>`:

```html
<script src="https://your-worker.workers.dev/w/YOUR-KEY/widget.js" async></script>
```

That is the whole installation. No account, no framework, no build step. The
widget draws itself inside a shadow root, so your site's styling cannot reach
into it and its styling cannot leak out onto your pages.

From the same screen you can pick the bubble colour, write the first line a
visitor sees, and switch the whole thing off. Text on the bubble is chosen for
you from the colour, so a pale accent still reads.

**Set your allowed sites.** Until you do, anyone who copies that line onto
their own page can spend your daily allowance. Enter `myshop.com` and only that
domain and its subdomains are served. There is a daily cap either way, because
the widget faces the open internet and inference is the one thing here that
costs money.

A visitor is a customer like any other: they appear in the customer list, the
assistant remembers them between visits, and a question it should not answer
reaches the same **Waiting for a person** queue. When you take one over, your
replies arrive in their open chat rather than in Telegram.

## Telling a bot how to behave

Send `/instruction` in the console. It opens the business you were last working
on, or asks which one if there is no obvious answer. The console publishes its
commands to Telegram, so they appear under the menu button rather than having
to be remembered.

| Command        | Goes to                        |
| -------------- | ------------------------------ |
| `/start`       | the console home               |
| `/instruction` | how the current bot behaves    |
| `/business`    | your businesses                |
| `/help`        | the guide, in your language    |

Instructions can be written three ways, and they all end in the same place:

- **Type them** into the chat, in any language.
- **Upload a file**, `skill.md` or any plain text, when they are long enough to
  be worth keeping somewhere.
- **Choose a style** and edit it. Four starting points are offered: a friendly
  shop, formal and precise, sales minded, and patient support. Picking one
  writes it in as ordinary instructions, so it can be edited or undone like
  anything typed by hand.

**Current agent skill** shows what is in force right now, in full rather than
as a preview, along with which starting point it came from. Edit and delete sit
on that screen too, so seeing and changing are the same visit.

The label names a style only while the text still matches it exactly. Change a
word and it reads as your own wording instead, because calling it "Friendly
shop" after you have edited it would describe behaviour you already changed.

The previous version is kept, so **Undo** puts it back if a change makes the
assistant worse. That happens more often than it sounds, which is why the undo
is there, and why deleting asks first.

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
