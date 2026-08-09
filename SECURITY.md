# Security Policy

## Reporting a vulnerability

Report security issues privately through GitHub Security Advisories on this
repository. Please do not open a public issue for a vulnerability.

Include the version or commit, the affected component, what an attacker can
achieve and the steps to reproduce. You will get an acknowledgement within seven
days.

## Scope

Muxel deploys into your own Cloudflare account and holds no infrastructure of
its own, so the interesting boundaries are these:

* The webhook endpoint, which is reachable by anyone on the internet.
* The console, which must be reachable only by an authorised operator.
* Isolation between businesses inside a single deployment.
* Handling of Telegram bot tokens and the deployment master key.
* Prompt injection through uploaded documents or customer messages.

Findings in a fork, a modified deployment or the Cloudflare platform itself are
out of scope. Report platform issues to Cloudflare.

## What the design assumes

* The operator Cloudflare account is trusted. Anyone with access to it can read
  every stored value and download the deployed Worker source.
* The master key lives in Worker secrets. Rotating it invalidates every stored
  bot token, which then have to be reconnected.
* Customer messages and uploaded documents are untrusted input.
