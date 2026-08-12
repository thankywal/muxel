/**
 * Released version of this deployment.
 *
 * A deployed copy has no link back to where it came from, so it cannot be told
 * that a fix exists. It checks instead: the scheduled handler compares this
 * against the VERSION file upstream and tells the owner when they differ.
 *
 * Bump this in the same commit as the change worth telling people about. The
 * root VERSION file must match, which a test enforces.
 */
export const MUXEL_VERSION = "0.15.3";

/** Where a deployment looks to find out whether it is behind. */
export const UPSTREAM_VERSION_URL =
  "https://raw.githubusercontent.com/thankywal/muxel/main/VERSION";

/** Instructions shown with an update notice. */
export const UPSTREAM_REPO = "https://github.com/thankywal/muxel";
