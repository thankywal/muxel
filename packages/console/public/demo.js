/**
 * The demonstration on an intro screen.
 *
 * It plays a conversation by itself: types a question, sends it, and writes the
 * answer out. Every answer here is written down in this file. Nothing on this
 * page talks to a model, which is why the bar above it says so — a scripted
 * reply passed off as a live one would be the single dishonest thing on a page
 * arguing that nothing is hidden.
 *
 * The questions are the ones a shop owner actually turns up with, and between
 * them they say everything the eight claim cards used to.
 */

// Both intro screens include this file; the console after pairing does not
// have the section, so nothing below it runs there.
if (document.getElementById("demo") !== null) {
const SCRIPT = [
  {
    q: "What do I have to sign up for?",
    a: "Nothing. There is no Muxel account, no plan and no dashboard of ours to log into.\n\n"
      + "You press Deploy, Cloudflare makes a copy of the code in your account, and that copy is "
      + "the whole product. The page you are reading is a page — it has no idea your deployment "
      + "exists until you tell it where to find it.",
  },
  {
    q: "Where do my customers' messages end up?",
    a: "In your Cloudflare account, and nowhere else.\n\n"
      + "The database is your D1, the files are your R2, the search index is your Vectorize. We "
      + "have no copy to lose, sell, hand over or leak, because the messages never travel to us "
      + "in the first place.",
  },
  {
    q: "How does it know my prices?",
    a: "You give it your own material and it answers from that.\n\n"
      + "A price list, a menu, a policy document — PDF, Word, Excel or plain text. It reads them "
      + "into one body of knowledge, and rebuilds it the moment you add or edit anything.\n\n"
      + "When a question is not answerable from what you gave it, it does not guess. It hands the "
      + "conversation to you.",
  },
  {
    q: "Where does it answer?",
    a: "On Telegram, and on your website.\n\n"
      + "One assistant, two front doors. The website widget is a line you paste into your page. "
      + "Telegram is a bot token from @BotFather.\n\n"
      + "Either way you can step into any conversation, reply as yourself, and hand it back.",
  },
  {
    q: "What does it cost to run?",
    a: "Cloudflare's free plan includes 10,000 neurons a day, which is what a reply is billed in.\n\n"
      + "On Gemma 4 that is roughly 880 replies a day at no cost. The console shows what each "
      + "answer drew and what is left, read from Cloudflare rather than estimated.",
  },
  {
    q: "What happens if you disappear?",
    a: "Nothing stops.\n\n"
      + "The code is in your GitHub, running on your keys, in your account. There is no licence "
      + "check and no call home. Updates are a button in your own console — press it and your "
      + "deployment pulls the new version into your own repository itself.",
  },
];

const demo = document.getElementById("demo");
const thread = document.getElementById("thread");
const field = document.getElementById("demoText");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Set while the demo is driving, so the visitor's own typing takes over. */
let playing = true;
let cancelled = false;

const esc = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

function youSaid(text) {
  thread.insertAdjacentHTML(
    "beforeend",
    `<div class="demo-turn you"><div class="demo-bub">${esc(text)}</div></div>`,
  );
  keepUp();
}

/** Writes an answer out, the way one arrives. */
async function itSaid(text) {
  thread.insertAdjacentHTML(
    "beforeend",
    `<div class="demo-turn">
       <div class="demo-who"><img src="/assets/logo.jpg" alt=""><b>Muxel</b></div>
       <div class="demo-body"></div>
     </div>`,
  );
  const body = thread.lastElementChild.querySelector(".demo-body");
  await wait(420);
  for (let cut = 0; cut <= text.length; cut += 2) {
    if (cancelled) break;
    body.innerHTML = `${esc(text.slice(0, cut))}<span class="demo-caret"></span>`;
    keepUp();
    await wait(9);
  }
  body.textContent = text;
  keepUp();
}

/** Keeps the newest line in view without dragging the whole page around. */
function keepUp() {
  thread.scrollTop = thread.scrollHeight;
}

/** Types into the box, so the question looks asked rather than pasted. */
async function typeQuestion(text) {
  for (let cut = 1; cut <= text.length; cut += 1) {
    if (!playing) return false;
    field.value = text.slice(0, cut);
    await wait(26);
  }
  await wait(320);
  return playing;
}

async function play() {
  for (const turn of SCRIPT) {
    if (!playing) return;
    if (!(await typeQuestion(turn.q))) return;
    field.value = "";
    youSaid(turn.q);
    await itSaid(turn.a);
    if (!playing) return;
    await wait(2600);
  }
  // Round again, so a page left open keeps saying something.
  if (playing) play();
}

/** Stops the demo driving the moment the visitor wants the box themselves. */
function handOver() {
  if (!playing) return;
  playing = false;
  cancelled = false;
  field.value = "";
}
field.addEventListener("focus", handOver);
field.addEventListener("keydown", handOver);

document.getElementById("demoSay").addEventListener("submit", async (event) => {
  event.preventDefault();
  handOver();
  const asked = field.value.trim();
  if (asked.length === 0) return;
  field.value = "";
  youSaid(asked);

  // A written answer exists for a written question. Anything else is a real
  // question, and the honest reply is that this page cannot answer it.
  const matched = SCRIPT.find((turn) => turn.q.toLowerCase() === asked.toLowerCase());
  if (matched !== undefined) {
    await itSaid(matched.a);
    return;
  }
  await itSaid(
    "That one I cannot answer here. This page has no model behind it and no idea what you sell — "
      + "the answers above are written down in the page's own source.\n\n"
      + "Your own deployment would answer it, from your own material.",
  );
  offerDeploy(asked);
});

function offerDeploy(asked) {
  const bg = document.createElement("div");
  bg.className = "demo-bg";
  bg.innerHTML = `<div class="demo-modal" role="dialog" aria-modal="true">
      <h3>Ask that one for real</h3>
      <p>“${esc(asked.slice(0, 120))}” needs an assistant that knows your business. That takes about
         ten minutes, and it runs in your account, not ours.</p>
      <ol>
        <li>Press Deploy. Cloudflare copies the code into your own account and your own GitHub.</li>
        <li>Make a bot with @BotFather and paste its token in, or paste the website widget into
            your page.</li>
        <li>Upload your price list. It answers from that.</li>
      </ol>
      <div class="cta">
        <a class="btn btn-primary"
           href="https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel">Deploy to your Cloudflare</a>
        <button class="btn btn-ghost" type="button" id="demoClose">Keep looking</button>
      </div>
    </div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener("click", (event) => event.target === bg && close());
  bg.querySelector("#demoClose").addEventListener("click", close);
}

// Only once it is on screen: a demonstration that played itself out above the
// fold would be finished before anybody scrolled to it.
const start = () => {
  if (!playing) return;
  play();
};
if ("IntersectionObserver" in window) {
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        watcher.disconnect();
        start();
      }
    }
  }, { threshold: 0.35 });
  watcher.observe(demo);
} else {
  start();
}
}
