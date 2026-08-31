# Muxel console

The product page and the owner's web console, in one small server.

## Why it is so small

The console does not reimplement anything. Every screen and every button in the
Telegram console already exists in the runtime as one function:

```ts
screenFor(env, locale, userId, action, args) -> { text, rows: ButtonSpec[][] }
```

So this package renders `Screen` objects and posts `{ action, args }` back. All
of the console's actions arrive at once, and a screen added to the runtime shows
up here without a line changing.

## It stores nothing

A deployment belongs to whoever deployed it, so this server never learns which
one you are using. The browser holds the address, sends it with each call, and
this server forwards the call and forgets it. There is no database and no
session here.

The one risk in that shape is an open proxy, so the address is checked before
use: https only, and the name is resolved and rejected if it points at a private
range.

## Running it

    npm install
    MUXEL_WORKER_URL=https://your-deployment.workers.dev npm start

`MUXEL_WORKER_URL` is optional. Without it the console asks the visitor for their
own deployment, which is the normal path.

Two faces, chosen by hostname: the product page for `muxel.site`, the console for
`app.muxel.site`. Any other host gets the product page.
