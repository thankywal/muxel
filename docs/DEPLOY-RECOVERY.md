# When the deploy button leaves a Hello world

Cloudflare's one click deploy copies this repository into your own GitHub
account and then builds it. That copy step occasionally fails, and it fails
quietly: the dashboard still says the deploy succeeded.

This page tells you how to recognise it in ten seconds and how to finish the
install either way. Nothing here is lost work. No documents, conversations or
credentials are involved yet, because the assistant never started.

## Check that it worked

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
ADMIN_BOT_TOKEN=your-console-bot-token \
OWNER_TELEGRAM_ID=your-telegram-id \
node scripts/install.mjs
```

The last two lines are optional. Without them the Worker deploys and waits for
those two settings, exactly as a button deploy does before you fill in the form.

The script creates the database, the namespace and the Vectorize index if they
are missing and adopts them if they already exist, so it is safe to run against
the half finished account a failed deploy leaves behind, and safe to run twice.
It creates the Vectorize index at 1024 dimensions with the cosine metric, which
is the pair the deploy form asks you to type in by hand.

It deploys the configuration shipped in this repository, not a separate one, so
what you get is the same Worker the button installs. A test holds the two to
each other.

When it finishes it prints your address. Open your console bot in Telegram and
send `/start`.

## Automatic updates after a direct install

A direct install has no GitHub copy, so the update workflow described in the
README has nothing to run in. Your deployment still checks for new versions and
still tells you in the console when one exists. To take an update, pull this
repository again and rerun `scripts/install.mjs`. It overwrites the Worker in
place and leaves your data alone.

If you would rather have the automatic updates, delete the Worker once your
account is otherwise healthy and use fix one. A successful copy gives you both.
