/**
 * Runs the console in a sandbox and hands back the values it built.
 *
 * The console is a classic script a browser fetches, not a module, so tests
 * that want its real behaviour have to execute it. Reading its source with a
 * regex would assert the shape of the text; this asserts the thing itself.
 */
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

export const consoleSource = readFileSync(
  new URL("../../console/public/app.js", import.meta.url),
  "utf8",
);

/** Just enough browser for the file to finish loading. */
export function evaluateConsole(): {
  NAV: { id: string; label: string }[];
  OWNER_MENU: { id: string; label: string }[];
  ALL_VIEWS: { id: string; label: string }[];
  TITLES: Record<string, [string, string]>;
  drawable: string[];
  /** The message renderer, run against text the way a real message arrives. */
  md: (text: string) => string;
  /** The cost line, given one answer's usage and the day's allowance. */
  costLine: (usage: unknown, allowance: unknown) => string;
  /** One turn, exactly as the thread draws it. */
  turnHtml: (
    message: { id: string; role: string; content: string; createdAt: string },
    steps: unknown[],
    cards: unknown[],
  ) => string;
  /** Every change one answer proposed, in the single card that holds them. */
  approvalCard: (approvals: unknown[]) => string;
  /** What version the deployment is on, as the settings panel prints it. */
  versionBlock: (version: unknown, repo: string) => string;
  /** The owner's little pixel face, drawn from their name. */
  pixelAvatar: (seed: string) => string;
  /** The field that collects one key to a service outside this deployment. */
  outsidePanel: (panel: {
    on: boolean;
    id: string;
    placeholder: string;
    leaves: string;
    where: string;
  }) => string;
} {
  const noop = (): unknown => undefined;
  const element = new Proxy(
    {
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      style: {},
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: noop,
      appendChild: noop,
      remove: noop,
      focus: noop,
      dataset: {},
    },
    { get: (target, key) => (key in target ? Reflect.get(target, key) : noop), set: () => true },
  );
  const store = new Map<string, string>();
  const sandbox = {
    document: {
      getElementById: () => element,
      querySelector: () => element,
      querySelectorAll: () => [],
      createElement: () => element,
      addEventListener: noop,
      body: element,
      documentElement: element,
    },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    window: { matchMedia: () => ({ matches: false }), addEventListener: noop },
    navigator: { clipboard: { writeText: async () => undefined } },
    fetch: async () => new Response("{}"),
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: noop,
    console,
    Response,
  };
  const context = createContext(sandbox);
  // The names are declared with `const`, which does not land on the global, so
  // the file is asked for them explicitly once it has run.
  runInContext(
    `${consoleSource}\n;globalThis.__read = () => ({ NAV, OWNER_MENU, ALL_VIEWS, TITLES,
       drawable: Object.keys({
         overview: viewOverview, inbox: viewInbox, assistant: viewAssistant,
         diagnostics: viewDiagnostics, agents: viewAgents, businesses: viewBusinesses,
         channels: viewChannels, customers: viewCustomers, messages: viewMessages,
         settings: viewSettings, logs: viewLogs, advanced: viewAdvanced,
       }),
       md,
       costLine: (usage, allowance) => { state.assistant = { allowance }; return costLine(usage); },
       turnHtml: (message, steps, cards) => turnHtml(message, steps, cards, undefined, {}),
       approvalCard,
       versionBlock,
       pixelAvatar,
       outsidePanel,
     });`,
    context,
  );
  return (sandbox as unknown as { __read: () => never }).__read();
}


