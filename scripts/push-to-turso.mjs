// Copie la base locale (data/almanach.db) vers la base Turso de la mise en ligne.
// Usage : TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… node scripts/push-to-turso.mjs
// Les lignes déjà présentes en ligne sont laissées telles quelles (INSERT OR IGNORE) : relancer ne duplique rien.
import { createClient } from "@libsql/client";
import path from "node:path";

const url = process.env.TURSO_DATABASE_URL;
if (!url?.startsWith("libsql://")) {
  console.error("TURSO_DATABASE_URL (libsql://…) et TURSO_AUTH_TOKEN sont requis.");
  process.exit(1);
}
const local = createClient({ url: `file:${path.resolve("data/almanach.db").replace(/\\/g, "/")}` });
const remote = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

// Les comptes puis les fiches d'abord : le reste s'y rattache par clé étrangère.
const FIRST = ["users", "media"];
const objects = (await local.execute("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")).rows;
const tables = objects.filter((o) => o.type === "table").sort((a, b) => {
  const rank = (n) => (FIRST.includes(n) ? FIRST.indexOf(n) : FIRST.length);
  return rank(a.name) - rank(b.name);
});

await remote.batch(
  [
    ...tables.map((t) => t.sql.replace(/^CREATE TABLE (?!IF NOT EXISTS)/i, "CREATE TABLE IF NOT EXISTS ")),
    ...objects.filter((o) => o.type === "index").map((i) => i.sql.replace(/^CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/i, "CREATE $1INDEX IF NOT EXISTS ")),
  ],
  "write",
);

for (const t of tables) {
  const { rows, columns } = await local.execute(`SELECT * FROM "${t.name}"`);
  const sql = `INSERT OR IGNORE INTO "${t.name}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
  for (let i = 0; i < rows.length; i += 300) {
    await remote.batch(rows.slice(i, i + 300).map((r) => ({ sql, args: columns.map((c) => r[c]) })), "write");
  }
  console.log(`${t.name} : ${rows.length}`);
}
console.log("Terminé.");
