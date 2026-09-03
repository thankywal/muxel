/**
 * The guide, rendered from the README.
 *
 * The README is the guide: it is what a new owner reads on GitHub, it is held
 * to the deploy form by tests, and it exists in five languages. /docs used to
 * point somewhere else entirely — the product page — so the one word in the
 * console that promised help led to a page with none. Rather than write a
 * second guide that would drift from the first, this renders the first.
 *
 * Pure: markdown in, HTML out. The server decides which file to read.
 */
import { Marked } from "marked";

export const LANGS = { en: "English", my: "မြန်မာ", th: "ไทย", ja: "日本語", zh: "中文" };

/** Files a README links to that are worth reading here rather than on GitHub. */
export const PAGES = {
  "deploy-recovery": { file: "DEPLOY-RECOVERY.md", title: "If the deploy did not finish" },
  "telegram-setup": { file: "TELEGRAM-SETUP.md", title: "Setup instructions to send in a chat" },
};

const REPO = "https://github.com/thankywal/muxel";

/** The file a README key reads: the language, or one of the extra pages. */
export function fileFor(key) {
  if (key === "en") return "README.md";
  if (key in LANGS) return `README.${key}.md`;
  if (key in PAGES) return PAGES[key].file;
  return null;
}

/**
 * A heading's id, the way GitHub makes one, so the README's own links
 * (`#before-you-start`) land here as they land there.
 *
 * Marks stay as well as letters: a Burmese or Thai heading is mostly vowel
 * signs and tone marks, and an id that dropped them read as a different word
 * and matched nothing.
 */
export function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Where a README link goes when the README is served from here.
 *
 * Another README is another language of this page. The two docs the README
 * points at are pages here too. Anything else in the repository is read on
 * GitHub, and anything absolute or in-page is left alone.
 */
export function rewriteHref(href) {
  if (!href || /^(https?:|mailto:|#)/.test(href)) return href;
  const [pathPart, hash = ""] = href.split("#");
  const anchor = hash ? `#${hash}` : "";
  if (pathPart === "README.md") return `/docs${anchor}`;
  const lang = /^README\.(\w+)\.md$/.exec(pathPart);
  if (lang && lang[1] in LANGS) return `/docs/${lang[1]}${anchor}`;
  for (const [key, page] of Object.entries(PAGES)) {
    if (pathPart === `docs/${page.file}` || pathPart === page.file) return `/docs/${key}${anchor}`;
  }
  if (pathPart.startsWith("docs/media/")) return `/${pathPart}`;
  return `${REPO}/blob/main/${pathPart}${anchor}`;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text of a heading's inline tokens, for the sidebar and the id. */
function textOf(tokens) {
  return tokens.map((t) => (t.tokens ? textOf(t.tokens) : t.text ?? "")).join("");
}

/**
 * Renders one markdown document into the guide's page.
 *
 * Returns the whole page and, for tests, the sections it found: every second
 * level heading, with the id it was given.
 */
export function renderGuide({ markdown, key = "en" }) {
  const sections = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const text = textOf(tokens);
        const id = slug(text);
        if (depth === 2) sections.push({ id, text });
        return `<h${depth} id="${escapeHtml(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        const external = /^https?:/.test(rewriteHref(href));
        const rel = external ? ' rel="noopener" target="_blank"' : "";
        return `<a href="${escapeHtml(rewriteHref(href))}"${t}${rel}>${this.parser.parseInline(tokens)}</a>`;
      },
      image({ href, title, text }) {
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${escapeHtml(rewriteHref(href))}" alt="${escapeHtml(text)}"${t} loading="lazy">`;
      },
    },
  });

  let body = marked.parse(markdown);
  // Raw HTML in the README — the hero figure and the screenshot table — never
  // meets the renderer above, so its paths are resolved the same way here.
  body = body.replace(/src="docs\/media\//g, 'src="/docs/media/');

  const lang = key in LANGS ? key : "en";
  const title = key in PAGES ? PAGES[key].title : "Guide";
  const nav = sections
    .map((s) => `<li><a href="#${escapeHtml(s.id)}">${escapeHtml(s.text)}</a></li>`)
    .join("\n");
  const languages = Object.entries(LANGS)
    .map(([code, name]) => {
      const href = code === "en" ? "/docs" : `/docs/${code}`;
      const on = code === lang && !(key in PAGES) ? ' class="on"' : "";
      return `<a href="${href}"${on} hreflang="${code}">${name}</a>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Muxel — ${escapeHtml(title)}</title>
<link rel="icon" href="/assets/logo.png">
<style>
  :root { --bg:#f7f8fa; --surface:#fff; --line:#e6e9ee; --ink:#0f172a; --ink-2:#334155; --muted:#6b7688;
    --brand:#f97316; --brand-ink:#ea580c; --brand-soft:#fff4ec; --code:#f1f4f8; color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b0f17; --surface:#131926; --line:#232b3a; --ink:#e8edf5;
    --ink-2:#c2cbdb; --muted:#8592a8; --brand-soft:#2a1a0e; --code:#0f1420; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,"Helvetica Neue",Arial,sans-serif; }
  a { color:var(--brand-ink); text-decoration:none; } a:hover { text-decoration:underline; }
  header { position:sticky; top:0; z-index:2; background:var(--surface); border-bottom:1px solid var(--line);
    display:flex; align-items:center; gap:14px; padding:10px 20px; flex-wrap:wrap; }
  header .brand { display:flex; align-items:center; gap:10px; font-weight:800; color:var(--ink); font-size:18px; letter-spacing:-.02em; }
  header .brand img { width:28px; height:28px; }
  header nav.lang { display:flex; gap:4px; flex-wrap:wrap; margin-left:auto; }
  header nav.lang a { padding:4px 10px; border-radius:999px; color:var(--ink-2); font-size:14px; }
  header nav.lang a.on { background:var(--brand-soft); color:var(--brand-ink); font-weight:600; }
  header .links a { color:var(--ink-2); font-size:14px; margin-left:14px; }
  .wrap { display:grid; grid-template-columns:260px minmax(0,1fr); gap:32px; max-width:1180px; margin:0 auto; padding:28px 20px 80px; }
  aside { position:sticky; top:64px; align-self:start; max-height:calc(100vh - 80px); overflow:auto; }
  aside h3 { margin:0 0 8px; font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  aside ul { list-style:none; margin:0; padding:0; } aside li { margin:0; }
  aside a { display:block; padding:6px 10px; border-radius:8px; color:var(--ink-2); font-size:14px; line-height:1.4; }
  aside a:hover { background:var(--surface); text-decoration:none; color:var(--ink); }
  article { min-width:0; }
  article h1 { font-size:34px; letter-spacing:-.02em; margin:0 0 14px; }
  article h2 { font-size:24px; margin:44px 0 12px; padding-top:16px; border-top:1px solid var(--line); scroll-margin-top:72px; }
  article h3 { font-size:18px; margin:28px 0 8px; scroll-margin-top:72px; }
  article img { max-width:100%; height:auto; border-radius:10px; }
  article table { display:block; width:100%; overflow-x:auto; border-collapse:collapse; margin:16px 0; font-size:15px; }
  article th, article td { border:1px solid var(--line); padding:8px 12px; text-align:left; vertical-align:top; }
  article th { background:var(--surface); }
  article code { font:.9em ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--code); padding:.12em .4em; border-radius:5px; }
  article pre { background:var(--code); border:1px solid var(--line); border-radius:10px; padding:14px 16px; overflow-x:auto; }
  article pre code { background:none; padding:0; }
  article blockquote { margin:16px 0; padding:4px 16px; border-left:3px solid var(--brand); color:var(--ink-2); }
  article details { border:1px solid var(--line); border-radius:10px; padding:10px 16px; margin:16px 0; background:var(--surface); }
  article summary { cursor:pointer; font-weight:600; }
  article hr { border:0; border-top:1px solid var(--line); margin:32px 0; }
  footer { border-top:1px solid var(--line); color:var(--muted); font-size:14px; text-align:center; padding:24px; }
  @media (max-width: 860px) { .wrap { grid-template-columns:1fr; } aside { position:static; max-height:none; } }
</style>
</head>
<body>
<header>
  <a class="brand" href="/docs"><img src="/assets/logo.png" alt=""> Muxel</a>
  <nav class="lang" aria-label="Language">${languages}</nav>
  <span class="links"><a href="https://app.muxel.site">Console</a><a href="${REPO}" rel="noopener" target="_blank">GitHub</a></span>
</header>
<div class="wrap">
  <aside><h3>On this page</h3><ul>${nav}</ul></aside>
  <article>
${body}
  </article>
</div>
<footer>Muxel runs in your own Cloudflare account. This page is the README, rendered.</footer>
</body>
</html>`;
  return { html, sections, title };
}
