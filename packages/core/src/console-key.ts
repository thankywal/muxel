/**
 * How short a console key is too short to be one.
 *
 * A deployment's address is public, so the key is the only thing between a
 * stranger and the console, and its length is the whole of that defence. That
 * is why there is no attempt limit anywhere near it: sixteen characters is far
 * past what can be guessed, so a limit would defend against an attack nobody
 * can mount while adding a number for the owner to wonder about.
 *
 * It lives here rather than in the runtime because two different programs have
 * to agree about it. The deployment refuses a short key at setup, and the
 * command line refuses one before it provisions anything — and the command
 * line cannot import the runtime. Two copies of a number are two numbers, and
 * the one that drifted would be the one the owner met first.
 */
export const CONSOLE_KEY_MIN_LENGTH = 16;
