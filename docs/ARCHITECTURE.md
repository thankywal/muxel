# Architecture

## The constraint that shapes everything

Muxel runs no servers. There is no Muxel API, no Muxel database and no Muxel
account. The command line tool authenticates as you, creates resources in your
Cloudflare account and exits. Everything after that runs between your Worker,
your data and Telegram.

Two consequences follow, and most of the design falls out of them.

The first is that the deployed code is readable by whoever owns the account.
`wrangler init --from-dash` downloads it. Protecting the source is therefore not
an available option, and the project does not pretend otherwise. It is licensed
openly and the name is what is defended.

The second is that there is nowhere central to put anything. Ownership,
credentials, menu state and usage counters all live inside the deployment.

## Request paths

There are exactly two entry points.

`GET /health` reports whether required configuration is present. It names the
missing settings but never their values, so the output can be pasted into a bug
report.

`POST /tg/:path` receives Telegram webhooks. The path is a random 24 character
identifier assigned when a bot is connected. The handler looks the path up,
compares the presented secret against a stored hash in constant time, then
acknowledges the request immediately and continues the work in `waitUntil`.
Acknowledging first matters because Telegram retries a slow webhook, and a retry
would send the customer a second reply.

An unknown path and a valid path with a bad secret both return 404. Probing
therefore reveals nothing.

## Tenancy

One deployment belongs to one operator. Inside it the operator may run any
number of businesses, and each business may own any number of bots.

Isolation is enforced in `packages/runtime/src/db/queries.ts`. Every function
that touches business content takes a `businessId` and includes it in the WHERE
clause. Handlers never assemble their own SQL. A missed check in a handler
therefore cannot cross a boundary, because the handler has no way to express a
query that ignores the partition.

Vectorize follows the same rule using one namespace per business. Namespace
filtering is applied before the vector search, so a similar phrasing in another
business cannot surface.

## Credentials

Bot tokens arrive at runtime, when an operator pastes one into the console, so
they cannot be Worker secrets. They are sealed with AES-GCM under a per
deployment master key and stored as ciphertext in D1. The master key is the only
Muxel secret that exists at deploy time.

The message containing a pasted token is deleted from the chat before any slower
work begins.

Rotating the master key invalidates every stored token. This is a deliberate
trade: a single key keeps the model simple, and reconnecting bots is a bounded
manual task.

## Ownership

A Telegram account number typed into a form proves nothing about who controls
that account. Instead `muxel claim` writes a single use code into KV with a
fifteen minute lifetime, and the first person to present it to the console bot
becomes the owner. That requires actually holding the account.

After bootstrap, owners reach every business. Other operators reach only the
businesses granted to them through `business_operator`.

## The console

The console is button driven and edits one message in place rather than sending
a new one per screen, so a long session leaves a single message in the chat.

Telegram caps `callback_data` at 64 bytes, which a menu heavy interface reaches
quickly. `packages/core/src/callback.ts` defines a compact versioned format and
the keyboard builder spills anything that does not fit into KV, substituting a
short reference. Callers describe a button as an action plus arguments and never
think about the limit.

Callback data is client supplied and therefore untrusted. Decoding validates the
version, the shape and the character set, and rejects anything else.

Free text is read only when a screen has explicitly armed a prompt. That pending
state lives in KV keyed by operator with a ten minute expiry, which keeps the
handler stateless and lets an abandoned prompt clean itself up.

## Retrieval

Uploads go to R2 first, so a later change to the segmentation strategy can be
replayed without asking the operator to upload anything again. Text extraction
uses the platform markdown conversion rather than a bundled parser.

Segmentation works on characters, not words. Burmese, Thai, Khmer, Chinese and
Japanese are written without spaces between words, so a splitter that counts
whitespace produces one unusable chunk for those scripts. The splitter prefers
blank lines, then sentence terminators drawn from every script it targets,
including the Burmese section mark, and falls back to a hard cut.

Chunk text is stored in D1 alongside the vector identifier. A retrieval hit can
therefore be rendered without a second round trip, and a vector whose row has
been deleted is skipped rather than producing dangling text.

## Inference

Replies go through the AI Gateway compatibility endpoint, where one request
shape reaches every supported provider. The model a business uses is a string in
D1, so changing it is a button press rather than a deploy. A named routing flow
can be stored in place of a concrete model, which moves fallback and budget
rules out of the code entirely.

Embeddings run on Workers AI directly. The daily neuron allowance covers a very
large volume of embedding work, so routing it to a paid provider would be waste.

## Prompt injection

The reply path is reachable by anyone who can find the bot, so the message body
is hostile input.

The handler exposes no tools. It cannot write anything on behalf of the sender
beyond appending to that sender's own transcript. Administrative operations
exist only on the console path, behind operator identity.

Retrieved documents are wrapped in delimiters and introduced as quoted business
data with an instruction to ignore any instructions found inside. An uploaded
file cannot redirect the assistant, because the assistant is told in advance
that the block is data.

Upstream errors are logged but never sent to the customer, so a provider error
string cannot leak configuration into a public chat.
