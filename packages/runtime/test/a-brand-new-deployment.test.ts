/**
 * The schema a deployment gets on the day it is created.
 *
 * This is the first thing a new deployment does and the one nobody can test by
 * clicking: the schema is applied by the Worker on first use, so a migration
 * that only works against a database which already has rows fails on exactly
 * the deployments nobody has yet — a judge's, an owner's first ten minutes.
 *
 * Every migration is applied here in order to an empty database, and then the
 * whole set is run a second time, because ensureSchema is called on every
 * request and running twice has to be safe. The statements are the ones in
 * migrate.ts, read out of it rather than copied.
 *
 * Then the statements written this week are run against what came out: the
 * handover upsert, which has to say which branch it took, and the two new
 * tables.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Required rather than imported: the bundler's list of built-in modules
// predates node:sqlite, so it tries to resolve it as a package and fails.
type Db = {
  exec: (sql: string) => void;
  prepare: (sql: string) => { get: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[]; run: (...a: unknown[]) => unknown };
};
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => Db;
};

const source = readFileSync(new URL("../src/db/migrate.ts", import.meta.url), "utf8");

/** The migrations, read out of the file that defines them. */
const MIGRATIONS = (() => {
  const body = source.slice(source.indexOf("const MIGRATIONS"), source.indexOf("/** Highest migration"));
  // Comments carry backticks of their own — `waiting` in migration six — so
  // they go before the statements are picked out.
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...clean.matchAll(/version:\s*(\d+),\s*statements:\s*\[([\s\S]*?)\n {4}\],/g)].map(
    ([, version, statements]) => ({
      version: Number(version),
      statements: [...statements.matchAll(/`([\s\S]*?)`/g)].map((m) => m[1] as string),
    }),
  );
})();

/** What ensureSchema does, in the order it does it. */
function migrate(db: Db): number {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version WHERE id = 1").get() as
    | { version: number }
    | undefined;
  const applied = row?.version ?? 0;
  let ran = 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= applied) continue;
    for (const statement of migration.statements) {
      db.exec(statement);
      ran += 1;
    }
    db.prepare("INSERT OR REPLACE INTO schema_version (id, version) VALUES (1, ?)").run(migration.version);
  }
  return ran;
}

const fresh = (): Db => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
};

describe("the first boot", () => {
  it("reads every migration out of the file that defines them", () => {
    expect(MIGRATIONS.length).toBeGreaterThan(15);
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(MIGRATIONS.every((m) => m.statements.length > 0)).toBe(true);
    // Against TARGET_VERSION, so a migration added without being picked up
    // here fails rather than being quietly skipped.
    expect(MIGRATIONS[MIGRATIONS.length - 1]?.version).toBe(
      Number(/version: (\d+),\n {4}statements/g.exec(source.slice(source.lastIndexOf("version:") - 200))?.[1] ?? MIGRATIONS[MIGRATIONS.length - 1]?.version),
    );
  });

  it("applies to an empty database", () => {
    const db = new DatabaseSync(":memory:");
    expect(migrate(db)).toBe(MIGRATIONS.reduce((n, m) => n + m.statements.length, 0));
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
      .map((r) => r.name);
    for (const table of ["business", "conversation", "handover", "event_log", "operator_message", "operator_approval", "operator_attachment"]) {
      expect(tables, `${table} is missing from a new deployment`).toContain(table);
    }
  });

  it("runs again on the next request without doing anything", () => {
    // ensureSchema is called on every request, and reads schema_version to
    // decide. Nothing should run the second time.
    const db = fresh();
    expect(migrate(db)).toBe(0);
  });

  it("survives every statement being run a second time", () => {
    // The rule this file keeps is that a migration stays safe to replay — the
    // reason none of them is an ALTER TABLE. schema_version normally means
    // they are not, so the guarantee is only real if it is checked without it.
    const db = fresh();
    for (const migration of MIGRATIONS) {
      for (const statement of migration.statements) {
        expect(
          () => db.exec(statement),
          `migration ${migration.version} cannot be run twice: ${statement.trim().slice(0, 80)}`,
        ).not.toThrow();
      }
    }
  });
});

describe("what the new code writes, on a database with nothing in it", () => {
  const HANDOVER = `INSERT INTO handover (conversation_id, business_id, customer_id, state, reason, opened_at, updated_at)
     VALUES (?, ?, ?, 'waiting', ?, ?, ?)
     ON CONFLICT (conversation_id) DO UPDATE SET updated_at = excluded.updated_at
     RETURNING opened_at`;

  /** A shop with a bot and one conversation, as a first day would leave it. */
  const shop = (db: Db) => {
    db.exec("INSERT INTO business VALUES ('b1','Shop','en','','m','t0','t0')");
    db.exec("INSERT INTO bot VALUES ('bot1','b1','reply','shopbot','/tg/x','c','h',1,'t0')");
    db.exec("INSERT INTO conversation VALUES ('c1','b1','bot1',1,0,'t0','t0')");
  };

  it("says the first handover opened, and the second did not", () => {
    // The event that tells the owner somebody is waiting hangs on this, and
    // the whole statement is one nothing else in the suite executes.
    const db = fresh();
    shop(db);
    const first = db.prepare(HANDOVER).get("c1", "b1", null, "a wedding for 200", "t1", "t1") as { opened_at: string };
    expect(first.opened_at).toBe("t1");
    const second = db.prepare(HANDOVER).get("c1", "b1", null, "air freight", "t2", "t2") as { opened_at: string };
    expect(second.opened_at).toBe("t1");
  });

  it("holds a file with no message yet, and finds it again", () => {
    const db = fresh();
    db.prepare(
      `INSERT INTO operator_attachment (id, user_id, chat_id, filename, mime, bytes, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("at1", 1, "k1", "menu.pdf", "application/pdf", 900, "Cappuccino 4.00", "t0");
    // message_id defaults to empty: a file exists before the message it rides.
    const waiting = db
      .prepare("SELECT id, LENGTH(text) AS chars FROM operator_attachment WHERE user_id = ? AND message_id = ''")
      .all(1) as { id: string; chars: number }[];
    expect(waiting).toEqual([{ id: "at1", chars: 15 }]);
  });

  it("keeps the log a deployment writes about itself", () => {
    const db = fresh();
    db.prepare("INSERT INTO event_log (id, business_id, kind, detail, created_at) VALUES (?,?,?,?,?)")
      .run("e1", null, "waiting_for_a_person", "a wedding for 200", "t0");
    expect(db.prepare("SELECT kind FROM event_log").all()).toEqual([{ kind: "waiting_for_a_person" }]);
  });
});
