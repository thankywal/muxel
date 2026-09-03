# When a deployment will not let you in

Three different things send people here, and they are worth telling apart in
the first minute:

* **The deploy button left a `Hello world`.** Cloudflare's copy step failed
  quietly and the dashboard still reported success. Start at *Check that it
  worked*.
* **The deploy form refused the configuration file.** Usually the GitHub rate
  limit rather than the file. See *A different failure that reads like ours*.
* **The deployment is fine and you cannot sign into it.** Nothing is broken and
  nothing is lost. That one is first, below, because it is the shortest.

## If you cannot get in

Losing your way into the console is not losing the deployment. The key that
signs you in is a setting on your own Worker, so you can set a different one
and use that.

1. In Cloudflare open **Workers and Pages**, open your Worker, then
   **Settings**, then **Variables and Secrets**.
2. Edit `CONSOLE_KEY` — or add it, if this deployment never had one — and put in
   a new phrase of at least 16 characters.
3. Open [app.muxel.site](https://app.muxel.site), paste your deployment's
   address, and enter the new key.

**Changing the key takes the old one back.** Signing in hands your browser a
token good for thirty days, and a token opened with a key stops working the
moment that is no longer the key. So a key you think somebody else has seen is
ended by replacing it, not by hunting down the browsers still holding it.

Nothing else changes. Your businesses, your uploaded documents and every
conversation live in your D1 database, and none of them is touched by this.

The one thing nobody can do is give you back the key you had. Your deployment
does not store it — it compares what you type against the setting — so there is
no copy of it anywhere to be read out, by us, by Cloudflare, or by you.

A Telegram console is the other door and the same holds in both directions. If
the console bot is gone, or you no longer have the account it was set up for,
add a `CONSOLE_KEY` and you are in from a browser regardless. If you have a key
and want the bot as well, set `ADMIN_BOT_TOKEN` and `OWNER_TELEGRAM_ID` in the
same place and open `/setup` on your deployment once; that request is what
registers the webhook. Either door on its own is a whole deployment, and adding
the second loses nothing set up under the first.

## Check that it worked

Nothing below this line is lost work. No documents, conversations or
credentials are involved yet, because the assistant never started.

Open your deployment's address with `/health` on the end:

```
https://muxel.<your subdomain>.workers.dev/health
```

| What you see                                     | What it means                      |
| ------------------------------------------------ | ---------------------------------- |
| A short status page, or a message naming a missing setting | Muxel is installed. Carry on with setup. |
| `Hello world`                                     | The copy failed. Follow this page. |
| An error page, or `error code: 1042`              | The copy failed. Follow this page. |

You can confirm it from GitHub too. Open the `muxel` repository that appeared in
your account. A good copy holds around ninety files, including a `packages`
folder. A failed copy holds two, `README.md` and `wrangler.jsonc`, and its
newest commit is called `Uploading template.` rather than `source repo import`.

## Why it happens

Cloudflare has two GitHub apps that can perform the copy. The current one
commits as `cloudflare[bot]` and copies the whole repository. The older
**Cloudflare Workers and Pages** app commits as
`cloudflare-workers-and-pages[bot]`, and when the deploy is routed through it
the copy can arrive holding only the configuration file that the deploy form had
already read. Workers Builds then has no code to build, never queues a build,
and the placeholder Worker that Cloudflare created at the start of the flow is
what stays deployed.

Nothing you did causes this, and nothing in the configuration prevents it. It
depends on which app your GitHub account already has installed.

## A different failure that reads like ours: the rate limit

If the setup form says

> There was a problem parsing the Wrangler configuration file. Please raise an
> issue in the Workers SDK repo.

**check the browser console before believing it.** In the case we saw, the
console held this instead:

```
GET https://raw.githubusercontent.com/thankywal/muxel/main/wrangler.jsonc
429 (Too Many Requests)
```

The setup form reads `wrangler.jsonc` straight from `raw.githubusercontent.com`
in your browser, on every load of the page. GitHub rate limits anonymous
requests per address, so reloading the deploy page repeatedly, or sharing an
address with many other people as most mobile networks in Asia do, is enough to
be refused. Nothing was parsed because nothing arrived, and the message names
the wrong cause. It will also send you to file a bug about a configuration file
that is fine.

The same rate limit shows up elsewhere as **"Cannot retrieve latest commit at
this time"** on the repository page. Both are the one cause.

What to do:

* Wait. These limits reset on their own, usually within the hour.
* Try from another network. A phone hotspot is a different address and is the
  quickest way to confirm this is the cause rather than guess at it.
* Stop reloading the deploy page while you wait, since each load spends another
  request against the same limit.
* Or install with fix two below, which never fetches anything from GitHub in
  your browser and so cannot hit this at all.

You can confirm the file itself is fine from any other machine:

```sh
curl -sI https://raw.githubusercontent.com/thankywal/muxel/main/wrangler.jsonc
```

A `200` there while your browser sees `429` is the whole diagnosis.

## Fix one: deploy again without the old app

This is the shorter route and it needs no tools.

1. Delete the failed copy. In Cloudflare, open **Workers and Pages**, open
   `muxel`, then **Settings**, then delete the Worker. In GitHub, open the
   `muxel` repository, then **Settings**, then **Delete this repository**.
2. Remove the old app. Open
   [github.com/settings/installations](https://github.com/settings/installations).
   If **Cloudflare Workers and Pages** is listed, open it and choose
   **Uninstall**. Leave any entry named simply **Cloudflare** alone.
3. Press the deploy button again. GitHub will ask to install the current
   Cloudflare app. Approve it.
4. Check `/health` again.

Leave the D1 database, the KV namespace and the Vectorize index in place. The
deploy form offers to reuse them, and reusing the Vectorize index saves you
re entering its two values.

If the second attempt lands on `Hello world` as well, use fix two rather than
trying a third time.

## Fix two: install it directly

This skips GitHub and Workers Builds completely, so the copy step that failed is
not involved. It works from any computer with [Node.js](https://nodejs.org)
version 20 or newer, and it can be run by someone helping you.

You need an API token. In Cloudflare open
[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens),
choose **Create Token**, start from the **Edit Cloudflare Workers** template,
then add edit permissions for **D1**, **Vectorize** and **Workers AI** before
creating it. Copy the token once, and your account id from the right hand side
of any account page.

```
git clone https://github.com/thankywal/muxel
cd muxel
pnpm install

CLOUDFLARE_API_TOKEN=your-token \
CLOUDFLARE_ACCOUNT_ID=your-account-id \
CONSOLE_KEY=a-phrase-you-make-up \
node scripts/install.mjs
```

`CONSOLE_KEY` is a phrase you invent, at least 16 characters, and it is the
whole of what a deployment needs from you. Keep it where you keep passwords.

The last line is optional. Without it the Worker deploys and then waits, and
says on its own `/setup` page what it is waiting for, exactly as a button deploy
does before you fill in the form.

If you would rather drive the console from Telegram, pass `ADMIN_BOT_TOKEN` and
`OWNER_TELEGRAM_ID` instead, or as well. They go on together or not at all,
because half a pair configures nothing. Either door finishes the install on its
own, so there is no reason to make a bot here unless you want one.

The script creates the database, the namespace and the Vectorize index if they
are missing and adopts them if they already exist, so it is safe to run against
the half finished account a failed deploy leaves behind, and safe to run twice.
It creates the Vectorize index at 1024 dimensions with the cosine metric, which
is the pair the deploy form asks you to type in by hand.

It deploys the configuration shipped in this repository, not a separate one, so
what you get is the same Worker the button installs. A test holds the two to
each other.

When it finishes it prints your address and what to do with it: open
[app.muxel.site](https://app.muxel.site), paste that address in and enter your
console key, or, if you set up a bot instead, open it in Telegram and send
`/start`.

## Installing from a terminal instead

`scripts/install.mjs` is for repairing an account that a deploy left half built.
If you simply prefer the command line, the packaged tool does the same job with
wrangler's own login rather than an API token:

```
node packages/cli/dist/index.js init --console-key "a-phrase-you-make-up"
```

It takes `--admin-bot-token` and `--owner-telegram-id` too, together, for a
Telegram console instead or as well. Giving it no door at all is the one thing
it refuses, and it names both when it does.

## Automatic updates after a direct install

A direct install has no GitHub copy, so the update workflow described in the
README has nothing to run in. Your deployment still checks for new versions and
still tells you in the console when one exists. To take an update, pull this
repository again and rerun `scripts/install.mjs`. It overwrites the Worker in
place and leaves your data alone.

If you would rather have the automatic updates, delete the Worker once your
account is otherwise healthy and use fix one. A successful copy gives you both.
