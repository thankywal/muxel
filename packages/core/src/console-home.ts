/**
 * Where the console is published.
 *
 * The console is a page, not a service: it holds no data, keeps no session and
 * talks to nothing but the owner's own Worker. So the address it is published
 * at is a convenience, not a dependency — an owner can serve the same files
 * themselves and lose nothing — but it is the address every document, every
 * setup page and every command line message sends a new owner to, and those
 * have to agree.
 *
 * It lives here rather than in the runtime because the programs that name it
 * cannot all import each other: the Worker puts it on its own first screen,
 * the command line puts it in what it prints after a deploy, and the console
 * itself links back to it. Two copies of an address are two addresses, and the
 * one that drifted would be the one an owner met first.
 *
 * The plain files this repository also ships — the READMEs, the deploy
 * scripts, the console's own HTML — cannot import anything. A test holds them
 * to this value instead.
 */
export const CONSOLE_HOME = "thankywal.github.io/muxel";

/** The same address as a link. */
export const CONSOLE_URL = `https://${CONSOLE_HOME}/`;

/** The guide, which is the README rendered, published beside the console. */
export const GUIDE_URL = `${CONSOLE_URL}docs/`;
