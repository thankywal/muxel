/**
 * The demonstration on an intro screen.
 *
 * It is the console's own chat, drawn the console's own way, answering the six
 * questions a shop owner actually turns up with. Between them those answers say
 * everything the four claim cards used to say, except that here the product is
 * saying it rather than being described.
 *
 * Nothing here talks to a model. Every answer is written in this file, and the
 * box is locked: a visitor picks from the questions there are answers for and
 * cannot type one there is no answer for, so nothing on this page can appear to
 * answer a question nobody asked it. Clicking the box says so, and offers the
 * two steps that would let them ask their own for real.
 */

// Both intro screens include this file; the console after pairing does not have
// the section, so nothing below it runs there.
if (document.getElementById("demo") !== null) {

const MODEL = "Qwen 3.8 27B";

const SCRIPT = [
  {
    q: "What do I have to sign up for?",
    steps: ["Read what a deployment is"],
    a: "Nothing. There is no Muxel account, no plan and no dashboard of ours to log into.\n\n"
      + "You press Deploy, Cloudflare makes a copy of the code in your account, and that copy is "
      + "the whole product. The page you are reading is a page — it has no idea your deployment "
      + "exists until you tell it where to find it.",
  },
  {
    q: "Where do my customers' messages end up?",
    steps: ["Looked at where the data lives"],
    a: "In your Cloudflare account, and nowhere else.\n\n"
      + "The database is your D1, the files are your R2, the search index is your Vectorize. We "
      + "have no copy to lose, sell, hand over or leak, because the messages never travel to us "
      + "in the first place.",
  },
  {
    q: "How does it know my prices?",
    steps: ["Searched what the agent knows", "Read a price list"],
    a: "You give it your own material and it answers from that.\n\n"
      + "A price list, a menu, a policy document — PDF, Word, Excel or plain text. It reads them "
      + "into one body of knowledge, and rebuilds it the moment you add or edit anything.\n\n"
      + "When a question is not answerable from what you gave it, it does not guess. It hands the "
      + "conversation to you.",
  },
  {
    q: "Where does it answer?",
    steps: ["Looked at your channels"],
    a: "On Telegram, and on your website.\n\n"
      + "One assistant, two front doors. The website widget is a line you paste into your page. "
      + "Telegram is a bot token from @BotFather.\n\n"
      + "Either way you can step into any conversation, reply as yourself, and hand it back.",
  },
  {
    q: "What does it cost to run?",
    steps: ["Checked the day's allowance"],
    a: "Cloudflare's free plan includes 10,000 neurons a day, which is what a reply is billed in.\n\n"
      + "On Gemma 4 that is roughly 880 replies a day at no cost. The console shows what each "
      + "answer drew and what is left, read from Cloudflare rather than estimated.",
  },
  {
    q: "What happens if you disappear?",
    steps: ["Read where the source lives"],
    a: "Nothing stops.\n\n"
      + "The code is in your GitHub, running on your keys, in your account. There is no licence "
      + "check and no call home. Updates are a button in your own console — press it and your "
      + "deployment pulls the new version into your own repository itself.",
  },
];

const thread = document.getElementById("thread");
const chips = document.getElementById("demoChips");
const sendBtn = document.getElementById("demoSend");
const stopBtn = document.getElementById("demoStop");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const CHECK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"'
  + ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

let answering = false;

function greet() {
  thread.classList.add("blank");
  thread.innerHTML = `<div class="greet">
      <img src="/assets/logo.png" alt="">
      <h3>What can I do for you?</h3>
      <p>Pick a question below. It answers the way your own deployment would, from what it was
         given.</p>
    </div>`;
}
greet();

function youSaid(text) {
  thread.classList.remove("blank");
  document.querySelector(".demo .greet")?.remove();
  thread.insertAdjacentHTML(
    "beforeend",
    `<div class="turn user"><div class="ubub">${esc(text)}</div></div>`,
  );
  keepUp();
}

/** Writes an answer out, under the same head the console draws. */
async function itSaid(turn) {
  thread.insertAdjacentHTML(
    "beforeend",
    `<div class="turn ai">
       <div class="steps"></div>
       <div class="ai-head"><img class="ai-av" src="/assets/logo.png" alt="">
         <b>${esc(MODEL)}</b><span class="work-label">Thinking</span>
         <span class="when">just now</span></div>
       <div class="ai-body"></div>
     </div>`,
  );
  const box = thread.lastElementChild;
  const steps = box.querySelector(".steps");
  const label = box.querySelector(".work-label");
  const body = box.querySelector(".ai-body");

  await wait(500);
  for (const step of turn.steps) {
    steps.insertAdjacentHTML("beforeend", `<div class="step">${CHECK}${esc(step)}</div>`);
    keepUp();
    await wait(420);
  }
  label.textContent = "Working";
  await wait(360);
  label.remove();

  for (let cut = 0; cut <= turn.a.length; cut += 2) {
    body.innerHTML = `${esc(turn.a.slice(0, cut))}<span class="caret"></span>`;
    keepUp();
    await wait(8);
  }
  body.textContent = turn.a;
  keepUp();
}

/** Keeps the newest line in view without dragging the whole page around. */
function keepUp() {
  thread.scrollTop = thread.scrollHeight;
}

/** The arrow is a black square for as long as an answer is being written. */
function working(on) {
  answering = on;
  sendBtn.hidden = on;
  stopBtn.hidden = !on;
  for (const chip of chips.querySelectorAll("button")) chip.disabled = on;
}

async function askIt(index) {
  if (answering) return;
  const turn = SCRIPT[index];
  if (turn === undefined) return;
  working(true);
  youSaid(turn.q);
  await itSaid(turn);
  working(false);
  chips.querySelectorAll("button")[index].disabled = true;
  // Once they have all been asked, the questions come back rather than leaving
  // a row of dead buttons behind.
  if ([...chips.querySelectorAll("button")].every((chip) => chip.disabled)) {
    await wait(1200);
    for (const chip of chips.querySelectorAll("button")) chip.disabled = false;
  }
}

chips.innerHTML = SCRIPT.map(
  (turn, index) => `<button type="button" class="opener" data-ask="${index}">${esc(turn.q)}</button>`,
).join("");
for (const chip of chips.querySelectorAll("[data-ask]")) {
  chip.addEventListener("click", () => askIt(Number(chip.dataset.ask)));
}

/**
 * The box does not take typing, and says why when someone tries.
 *
 * Every answer on this page is one somebody wrote. A box that accepted a real
 * question would either have to answer it from the nearest written one or sit
 * there doing nothing, and the first of those is how a demonstration starts
 * making claims nobody checked.
 */
document.querySelector(".demo .composer").addEventListener("click", offerDeploy);

function offerDeploy() {
  if (document.querySelector(".demo-bg") !== null) return;
  const bg = document.createElement("div");
  bg.className = "demo-bg";
  bg.innerHTML = `<div class="demo-modal" role="dialog" aria-modal="true">
      <h3>Ask it your own question</h3>
      <p>This one only knows the answers on this page. An assistant that knows your business takes
         about ten minutes, and it runs in your account, not ours.</p>
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

}
