import "server-only";
import { createClient, type Client, type InValue, type Row } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import type { Kind, Status } from "@/lib/kinds";

// En local : fichier SQLite dans data/. En ligne (Vercel) : base Turso, compatible SQLite.
// Plusieurs comptes (connexion Discord) : chaque fiche, réglage et événement porte son user_id.
const TURSO_URL = process.env.TURSO_DATABASE_URL;

function connect(): Client {
  if (TURSO_URL) return createClient({ url: TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  if (process.env.VERCEL) throw new Error("TURSO_DATABASE_URL manquant : sur Vercel, la base doit être distante.");
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return createClient({ url: `file:${path.join(dir, "almanach.db").replace(/\\/g, "/")}` });
}

const KINDS_SQL = "'film','serie','jeu','anime','manga','ln','roman'";

const MEDIA_TABLE = (name: string) => `CREATE TABLE IF NOT EXISTS ${name} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN (${KINDS_SQL})),
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    year INTEGER,
    cover TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'prevu' CHECK (status IN ('prevu','en_cours','termine','pause','abandonne')),
    -- Épisodes, chapitres ou volumes vus/lus ; total s'il est connu.
    progress INTEGER NOT NULL DEFAULT 0,
    total INTEGER,
    -- Note sur 10 (demi-points), affichée en étoiles sur 5.
    rating REAL,
    started_on TEXT,
    notes TEXT NOT NULL DEFAULT '',
    -- Critique (AniList, Backloggd, Letterboxd ou écrite ici) et « j'aime ».
    review TEXT NOT NULL DEFAULT '',
    liked INTEGER NOT NULL DEFAULT 0,
    -- Favori : rang dans les favoris de son type (1 = couronne), NULL sinon.
    fav_rank INTEGER,
    -- Rattachement manuel : NULL = automatique, 0 = aucun parent, sinon id de la fiche parente.
    parent_override INTEGER,
    anilist_id INTEGER,
    tmdb_id INTEGER,
    tvmaze_id INTEGER,
    steam_id INTEGER,
    letterboxd_slug TEXT,
    backloggd_slug TEXT,
    mangadex_id TEXT,
    isbn TEXT,
    author TEXT NOT NULL DEFAULT '',
    format TEXT,
    source TEXT,
    relations_at TEXT,
    aliases_at TEXT,
    cover_grid TEXT NOT NULL DEFAULT '',
    mal_id INTEGER,
    mal_at TEXT,
    anilist_dirty INTEGER NOT NULL DEFAULT 0,
    -- Privé (comme sur AniList) : invisible pour les autres comptes (bibliothèque, fil, profil).
    private INTEGER NOT NULL DEFAULT 0,
    -- Fiche VNDB d'un jeu ('-' = cherchée, absente de VNDB).
    vndb_id TEXT,
    -- Relation à l'œuvre parente choisie à la main (« Remake », « Adaptation »…), NULL = déduite.
    parent_relation TEXT,
    -- Infos de la colonne et tags saisis à la main (JSON), à la place de ceux des sources.
    info_override TEXT,
    -- Bannière choisie à la main (adresse ou image envoyée), à la place de celle des sources.
    banner TEXT NOT NULL DEFAULT '',
    -- Où et quand se passe l'œuvre (listes séparées par des virgules) : filtres et stats.
    setting_country TEXT NOT NULL DEFAULT '',
    setting_place TEXT NOT NULL DEFAULT '',
    setting_era TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`;

const MEDIA_INDEXES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS media_anilist ON media (user_id, anilist_id) WHERE anilist_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS media_letterboxd ON media (user_id, letterboxd_slug) WHERE letterboxd_slug IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS media_backloggd ON media (user_id, backloggd_slug) WHERE backloggd_slug IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS media_tvmaze ON media (user_id, tvmaze_id) WHERE tvmaze_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS media_isbn ON media (user_id, isbn) WHERE isbn IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS media_user ON media (user_id, status, updated_at)`,
];

// Une même œuvre chez tous les membres (page d'œuvre, partage des pays / lieux / époques). Créés après l'ajout des
// colonnes v2 (vndb_id).
const WORK_INDEXES = [
  ...["anilist_id", "steam_id", "tmdb_id", "tvmaze_id", "isbn", "backloggd_slug", "vndb_id"].map((c) => `CREATE INDEX IF NOT EXISTS media_work_${c} ON media (${c}) WHERE ${c} IS NOT NULL`),
  `CREATE INDEX IF NOT EXISTS media_work_title ON media (lower(title))`,
];

const EVENT_TABLE = (name: string) => `CREATE TABLE IF NOT EXISTS ${name} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    at INTEGER NOT NULL,
    type TEXT NOT NULL,
    media_id INTEGER,
    title TEXT NOT NULL DEFAULT '',
    cover TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL DEFAULT 'app',
    ref TEXT,
    -- Retiré du fil par son auteur (gardé pour qu'une resynchro ne le recrée pas).
    hidden INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, ref)
  )`;

const STEAM_TABLE = (name: string) => `CREATE TABLE IF NOT EXISTS ${name} (
    user_id INTEGER NOT NULL,
    appid INTEGER NOT NULL,
    name TEXT NOT NULL,
    minutes INTEGER NOT NULL DEFAULT 0,
    last_played INTEGER NOT NULL DEFAULT 0,
    last_unlock INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, appid)
  )`;

const SCHEMA = [
  // Réglages globaux de l'appli (version du schéma) ; ceux de chaque compte sont dans user_setting.
  `CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // Comptes : connexion Discord ; un nouveau compte attend l'accord d'un admin (status 'pending').
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('admin','member','pending')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS user_setting (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  )`,
  MEDIA_TABLE("media"),
  ...MEDIA_INDEXES,
  ...WORK_INDEXES,
  // Une ligne par média terminé (un revisionnage en ajoute une autre) : c'est ce que lit le calendrier.
  `CREATE TABLE IF NOT EXISTS log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    finished_on TEXT,
    rating REAL,
    rewatch INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'app',
    backloggd_pending INTEGER NOT NULL DEFAULT 0,
    source_day TEXT,
    unknown INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS log_date ON log (finished_on)`,
  `CREATE INDEX IF NOT EXISTS log_media ON log (media_id)`,
  // Activité au jour le jour : épisodes/chapitres avancés, sessions de jeu du journal Backloggd.
  `CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    minutes INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'app',
    UNIQUE (media_id, day, source)
  )`,
  `CREATE INDEX IF NOT EXISTS activity_day ON activity (day)`,
  `CREATE TABLE IF NOT EXISTS link (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  )`,
  // Relations AniList entre œuvres (communes à tous les comptes).
  `CREATE TABLE IF NOT EXISTS relation (
    anilist_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    PRIMARY KEY (anilist_id, target_id, type)
  )`,
  // Œuvres AniList dont les relations ont été lues (y compris hors bibliothèque, pour suivre les chaînes de films).
  `CREATE TABLE IF NOT EXISTS relation_node (
    anilist_id INTEGER PRIMARY KEY,
    format TEXT,
    title TEXT NOT NULL DEFAULT '',
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  EVENT_TABLE("event"),
  `CREATE INDEX IF NOT EXISTS event_at ON event (user_id, at DESC)`,
  `CREATE INDEX IF NOT EXISTS event_media ON event (media_id, type, at)`,
  STEAM_TABLE("steam_game"),
  `CREATE TABLE IF NOT EXISTS alias (
    media_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (media_id, title)
  )`,
  // Fiches détaillées des sources (AniList, VNDB, Steam, TMDB…), communes à tous les comptes : clé « source:id ».
  `CREATE TABLE IF NOT EXISTS info_cache (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  )`,
  // Autres titres ajoutés à la main (en plus de ceux des sources).
  `CREATE TABLE IF NOT EXISTS title_alias (
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    PRIMARY KEY (media_id, title)
  )`,
  // Openings / endings ajoutés à la main (lien YouTube), pour les jeux, VN et ce qu'animethemes n'a pas.
  `CREATE TABLE IF NOT EXISTS theme (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'OP',
    title TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL
  )`,
];

// Colonnes ajoutées après le passage au multi-comptes : ajoutées en place aux bases existantes.
const V2_COLUMNS: [table: string, column: string, definition: string][] = [
  ["media", "private", "INTEGER NOT NULL DEFAULT 0"],
  ["media", "vndb_id", "TEXT"],
  ["media", "parent_relation", "TEXT"],
  ["media", "info_override", "TEXT"],
  ["media", "banner", "TEXT NOT NULL DEFAULT ''"],
  ["media", "setting_country", "TEXT NOT NULL DEFAULT ''"],
  ["media", "setting_place", "TEXT NOT NULL DEFAULT ''"],
  ["media", "setting_era", "TEXT NOT NULL DEFAULT ''"],
  ["event", "hidden", "INTEGER NOT NULL DEFAULT 0"],
];

// Base de la première version (un seul utilisateur) : colonnes ajoutées au fil des versions, puis passage
// au multi-comptes (tables reconstruites, tout rattaché au compte n°1, que le premier admin réclame).
const V1_COLUMNS: [table: string, column: string, definition: string, backfill?: string][] = [
  ["log", "source_day", "TEXT", "UPDATE log SET source_day = finished_on WHERE source <> 'app'"],
  ["log", "unknown", "INTEGER NOT NULL DEFAULT 0"],
  ["media", "anilist_dirty", "INTEGER NOT NULL DEFAULT 0"],
  ["media", "format", "TEXT"],
  ["media", "relations_at", "TEXT"],
  ["media", "source", "TEXT"],
  ["media", "aliases_at", "TEXT"],
  ["media", "cover_grid", "TEXT NOT NULL DEFAULT ''"],
  ["media", "mal_id", "INTEGER"],
  ["media", "mal_at", "TEXT"],
];

const V1_MEDIA_COLUMNS = [
  "id", "kind", "title", "subtitle", "year", "cover", "status", "progress", "total", "rating", "started_on", "notes",
  "anilist_id", "tmdb_id", "tvmaze_id", "steam_id", "letterboxd_slug", "backloggd_slug", "mangadex_id", "format", "source",
  "relations_at", "aliases_at", "cover_grid", "mal_id", "mal_at", "anilist_dirty", "created_at", "updated_at",
].join(", ");

async function columns(c: Client, table: string): Promise<string[]> {
  return (await c.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name));
}

async function migrateV1(c: Client) {
  for (const [table, column, definition, backfill] of V1_COLUMNS) {
    if ((await columns(c, table)).includes(column)) continue;
    await c.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    if (backfill) await c.execute(backfill);
  }
  const owner = (await c.execute("SELECT value FROM setting WHERE key IN ('pseudo', 'anilist_user') ORDER BY key DESC LIMIT 1")).rows[0];
  const hasEventTable = (await columns(c, "event")).length > 0;
  const hasSteamTable = (await columns(c, "steam_game")).length > 0;
  // Sans contrôle des clés étrangères pendant la reconstruction : supprimer l'ancienne table media
  // effacerait sinon les fins et l'activité en cascade.
  await c.execute("PRAGMA foreign_keys = OFF");
  await c.batch(
    [
      SCHEMA[1],
      SCHEMA[2],
      { sql: "INSERT OR IGNORE INTO users (id, name, status) VALUES (1, ?, 'admin')", args: [String(owner?.value ?? "")] },
      MEDIA_TABLE("media_v2"),
      `INSERT INTO media_v2 (${V1_MEDIA_COLUMNS}, user_id) SELECT ${V1_MEDIA_COLUMNS}, 1 FROM media`,
      "DROP TABLE media",
      "ALTER TABLE media_v2 RENAME TO media",
      ...MEDIA_INDEXES,
      "INSERT OR IGNORE INTO user_setting (user_id, key, value) SELECT 1, key, value FROM setting WHERE key <> 'schema_version'",
      "DELETE FROM setting WHERE key <> 'schema_version'",
      ...(hasEventTable
        ? [
            EVENT_TABLE("event_v2"),
            "INSERT INTO event_v2 (id, user_id, at, type, media_id, title, cover, data, source, ref) SELECT id, 1, at, type, media_id, title, cover, data, source, ref FROM event",
            "DROP TABLE event",
            "ALTER TABLE event_v2 RENAME TO event",
          ]
        : []),
      ...(hasSteamTable
        ? [
            STEAM_TABLE("steam_v2"),
            "INSERT INTO steam_v2 (user_id, appid, name, minutes, last_played, last_unlock) SELECT 1, appid, name, minutes, last_played, last_unlock FROM steam_game",
            "DROP TABLE steam_game",
            "ALTER TABLE steam_v2 RENAME TO steam_game",
          ]
        : []),
      "INSERT INTO setting (key, value) VALUES ('schema_version', '2') ON CONFLICT (key) DO UPDATE SET value = '2'",
    ],
    "write",
  );
  await c.execute("PRAGMA foreign_keys = ON").catch(() => {});
}

let client: Client | null = null;
let ready: Promise<void> | null = null;

async function db(): Promise<Client> {
  client ??= connect();
  ready ??= (async () => {
    const c = client!;
    await c.execute(SCHEMA[0]);
    const legacy = (await columns(c, "media")).length > 0 && !(await columns(c, "media")).includes("user_id");
    if (legacy) await migrateV1(c);
    await c.execute("PRAGMA foreign_keys = ON").catch(() => {});
    for (const [table, column, def] of V2_COLUMNS) {
      const cols = await columns(c, table);
      if (cols.length && !cols.includes(column)) await c.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    }
    await c.batch(SCHEMA, "write");
    await c.execute("INSERT OR IGNORE INTO setting (key, value) VALUES ('schema_version', '2')");
    if (!(await c.execute("SELECT 1 FROM setting WHERE key = 'favs_global'")).rows.length) {
      await c.batch(
        [
          `UPDATE media SET fav_rank = (SELECT rn FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY fav_rank, kind, id) AS rn
             FROM media WHERE fav_rank IS NOT NULL) x WHERE x.id = media.id) WHERE fav_rank IS NOT NULL`,
          "UPDATE media SET fav_rank = NULL WHERE fav_rank > 10",
          "INSERT OR IGNORE INTO setting (key, value) VALUES ('favs_global', '1')",
        ],
        "write",
      );
    }
  })();
  try {
    await ready;
  } catch (err) {
    ready = null; // une erreur de connexion passagère ne doit pas bloquer les requêtes suivantes
    throw err;
  }
  return client;
}

export async function all<T = Row>(sql: string, args: InValue[] = []): Promise<T[]> {
  const res = await (await db()).execute({ sql, args });
  // Objets simples : les Row de libSQL ne peuvent pas être passées telles quelles aux composants client.
  return res.rows.map((row) => Object.fromEntries(res.columns.map((c, i) => [c, row[i]]))) as T[];
}

export async function get<T = Row>(sql: string, args: InValue[] = []): Promise<T | undefined> {
  return (await all<T>(sql, args))[0];
}

export async function run(sql: string, args: InValue[] = []): Promise<{ id: number; changes: number }> {
  const res = await (await db()).execute({ sql, args });
  return { id: Number(res.lastInsertRowid ?? 0), changes: res.rowsAffected };
}

export type Stmt = { sql: string; args: InValue[] };

export async function batch(stmts: Stmt[]) {
  const c = await db();
  for (let i = 0; i < stmts.length; i += 200) await c.batch(stmts.slice(i, i + 200), "write");
}

// ---------------------------------------------------------------------------------------------
// Pays, lieux et époques de l'action : ils décrivent l'œuvre, pas le suivi de chacun. Une fiche vide reprend les
// valeurs d'une fiche de la même œuvre (autre compte, non privée) ; une valeur déjà saisie n'est jamais écrasée.
//   { uid }  : les fiches d'un compte ;  { like } : toutes les fiches de cette œuvre ;  {} : toutes.

// Lecture économe (le quota de Turso compte chaque ligne lue) : une œuvre passe par les index ci-dessous ; un compte
// lit une fois les fiches qui ont des valeurs, puis les siennes. Seules les fiches complétées sont réécrites.
const WORK_KEYS = ["anilist_id", "steam_id", "tmdb_id", "tvmaze_id", "isbn", "backloggd_slug", "vndb_id"] as const;
const SETTING_COLS = ["setting_country", "setting_place", "setting_era"] as const;
type WorkRow = Pick<Media, "id" | "user_id" | "kind" | "private" | "title" | "updated_at" | (typeof SETTING_COLS)[number] | (typeof WORK_KEYS)[number]>;
const WORK_ROW = `id, user_id, kind, private, title, updated_at, ${SETTING_COLS.join(", ")}, ${WORK_KEYS.join(", ")}`;

function workKeys(r: Pick<Media, "kind" | "title" | (typeof WORK_KEYS)[number]>): string[] {
  const keys = WORK_KEYS.filter((k) => r[k] != null && r[k] !== "" && !(k === "vndb_id" && r[k] === "-")).map((k) => `${r.kind}:${k}:${r[k]}`);
  return [...keys, `${r.kind}:title:${r.title.toLowerCase()}`];
}

export async function adoptSettings(scope: { uid?: number; like?: Pick<Media, "kind" | "title" | (typeof WORK_KEYS)[number]> }): Promise<number> {
  let donors: WorkRow[];
  let targets: WorkRow[];
  if (scope.like) {
    const l = scope.like;
    const terms = ["lower(title) = lower(?)"];
    const args: InValue[] = [l.title];
    for (const k of WORK_KEYS) if (l[k] != null && l[k] !== "" && !(k === "vndb_id" && l[k] === "-")) (terms.push(`${k} = ?`), args.push(l[k]));
    const rows = (await all<WorkRow>(`SELECT ${WORK_ROW} FROM media WHERE ${terms.join(" OR ")}`, args)).filter((r) => r.kind === l.kind);
    donors = rows;
    targets = rows.filter((r) => scope.uid == null || r.user_id === scope.uid);
  } else {
    donors = await all<WorkRow>(`SELECT ${WORK_ROW} FROM media WHERE private = 0 AND (${SETTING_COLS.map((c) => `${c} <> ''`).join(" OR ")})`);
    targets = await all<WorkRow>(
      `SELECT ${WORK_ROW} FROM media WHERE (${SETTING_COLS.map((c) => `${c} = ''`).join(" OR ")})${scope.uid != null ? " AND user_id = ?" : ""}`,
      scope.uid != null ? [scope.uid] : [],
    );
  }
  // Pour chaque clé d'œuvre, les fiches publiques qui ont des valeurs, la plus récente d'abord.
  const byKey = new Map<string, WorkRow[]>();
  for (const d of donors.filter((d) => !d.private).sort((a, b) => b.updated_at.localeCompare(a.updated_at)))
    for (const k of workKeys(d)) byKey.set(k, [...(byKey.get(k) ?? []), d]);
  const stmts: Stmt[] = [];
  for (const t of targets) {
    const near = workKeys(t).flatMap((k) => byKey.get(k) ?? []).filter((d) => d.id !== t.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    for (const col of SETTING_COLS) {
      if (t[col]) continue;
      const value = near.find((d) => d[col])?.[col];
      if (value) stmts.push({ sql: `UPDATE media SET ${col} = ? WHERE id = ? AND ${col} = ''`, args: [value, t.id] });
    }
  }
  if (stmts.length) await batch(stmts);
  return stmts.length;
}

// ---------------------------------------------------------------------------------------------
// Modèle

export type User = {
  id: number;
  discord_id: string | null;
  name: string;
  avatar: string;
  status: "admin" | "member" | "pending";
  created_at: string;
  last_seen: string | null;
};

export type Media = {
  id: number;
  user_id: number;
  kind: Kind;
  title: string;
  subtitle: string;
  year: number | null;
  cover: string;
  status: Status;
  progress: number;
  total: number | null;
  rating: number | null;
  started_on: string | null;
  notes: string;
  review: string;
  liked: number;
  fav_rank: number | null;
  parent_override: number | null;
  anilist_id: number | null;
  tmdb_id: number | null;
  tvmaze_id: number | null;
  steam_id: number | null;
  letterboxd_slug: string | null;
  backloggd_slug: string | null;
  mangadex_id: string | null;
  isbn: string | null;
  author: string;
  format: string | null;
  relations_at: string | null;
  source: string | null;
  aliases_at: string | null;
  cover_grid: string;
  mal_id: number | null;
  mal_at: string | null;
  anilist_dirty: number;
  private: number;
  vndb_id: string | null;
  parent_relation: string | null;
  info_override: string | null;
  banner: string;
  setting_country: string;
  setting_place: string;
  setting_era: string;
  created_at: string;
  updated_at: string;
};

// finished_on : « AAAA-MM-JJ », ou seulement « AAAA-MM » / « AAAA » si le jour (ou le mois) est inconnu,
// ou NULL : à dater, sauf si unknown = 1 (date inconnue assumée).
export type Log = {
  id: number;
  media_id: number;
  finished_on: string | null;
  unknown: number;
  source_day: string | null;
  rating: number | null;
  rewatch: number;
  source: string;
  backloggd_pending: number;
};

export type Link = { id: number; media_id: number; label: string; url: string; position: number };

// Réglages d'un compte (pseudos, jetons, clés…).
export async function getSetting(uid: number, key: string): Promise<string> {
  return (await get<{ value: string }>("SELECT value FROM user_setting WHERE user_id = ? AND key = ?", [uid, key]))?.value ?? "";
}

export async function setSetting(uid: number, key: string, value: string) {
  await run(
    "INSERT INTO user_setting (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value",
    [uid, key, value],
  );
}

// Fiche d'un compte (null si elle n'existe pas ou appartient à un autre compte).
export async function getMedia(uid: number, id: number): Promise<Media | undefined> {
  return get<Media>("SELECT * FROM media WHERE id = ? AND user_id = ?", [id, uid]);
}

export type MediaInput = Partial<
  Omit<
    Media,
    | "id" | "user_id" | "created_at" | "updated_at" | "anilist_dirty" | "relations_at" | "source" | "aliases_at" | "cover_grid"
    | "mal_id" | "mal_at" | "fav_rank" | "parent_override" | "private" | "parent_relation" | "info_override" | "banner" | "setting_country" | "setting_place" | "setting_era"
  >
> & { kind: Kind; title: string };

const MEDIA_COLUMNS = [
  "kind", "title", "subtitle", "year", "cover", "status", "progress", "total", "rating", "started_on", "notes", "review", "liked",
  "anilist_id", "tmdb_id", "tvmaze_id", "steam_id", "letterboxd_slug", "backloggd_slug", "mangadex_id", "isbn", "author", "format",
  "vndb_id",
] as const;

// Retrouve une fiche du compte par l'un de ses identifiants externes, puis par titre + année pour films et jeux
// (l'export CSV de Letterboxd n'a pas de slug).
export async function findMedia(uid: number, m: MediaInput): Promise<Media | undefined> {
  const keys: [string, InValue | undefined][] = [
    ["anilist_id", m.anilist_id],
    ["letterboxd_slug", m.letterboxd_slug],
    ["backloggd_slug", m.backloggd_slug],
    ["tvmaze_id", m.tvmaze_id],
    ["tmdb_id", m.kind === "film" ? m.tmdb_id : undefined],
    ["steam_id", m.steam_id],
    ["isbn", m.isbn],
    ["vndb_id", m.kind === "jeu" ? m.vndb_id : undefined],
  ];
  for (const [col, val] of keys) {
    if (val == null || val === "") continue;
    const row = await get<Media>(`SELECT * FROM media WHERE user_id = ? AND ${col} = ? AND kind = ?`, [uid, val, m.kind]);
    if (row) return row;
  }
  if (m.kind === "film" || m.kind === "jeu") {
    return get<Media>(
      "SELECT * FROM media WHERE user_id = ? AND kind = ? AND lower(title) = lower(?) AND (? IS NULL OR year IS NULL OR year = ?)",
      [uid, m.kind, m.title, m.year ?? null, m.year ?? null],
    );
  }
}

// Crée la fiche ou complète l'existante. Les champs déjà remplis ne sont écrasés que si `overwrite`.
export async function upsertMedia(uid: number, m: MediaInput, overwrite: (keyof MediaInput)[] = []): Promise<Media> {
  const existing = await findMedia(uid, m);
  if (!existing) {
    const cols = MEDIA_COLUMNS.filter((c) => m[c] !== undefined);
    const { id } = await run(
      `INSERT INTO media (user_id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`,
      [uid, ...cols.map((c) => (m[c] ?? null) as InValue)],
    );
    return (await getMedia(uid, id))!;
  }
  const sets: string[] = [];
  const args: InValue[] = [];
  for (const c of MEDIA_COLUMNS) {
    const v = m[c];
    if (v === undefined || v === null || v === "") continue;
    const cur = existing[c];
    // « ?id » : slug Letterboxd introuvable lors d'une recherche d'affiche, à remplacer dès qu'il est connu.
    const empty = cur === null || cur === "" || (typeof cur === "string" && cur.startsWith("?"));
    if ((overwrite.includes(c) || empty || (c === "total" && cur !== v)) && cur !== v) {
      sets.push(`${c} = ?`);
      args.push(v as InValue);
    }
  }
  if (sets.length) {
    await run(`UPDATE media SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`, [...args, existing.id]);
    return (await getMedia(uid, existing.id))!;
  }
  return existing;
}

// Ajoute une fin. Une seule par fiche et par date ; une fin sans date n'est gardée que si la fiche n'en a aucune.
// Renvoie l'id créé, ou null si elle existait déjà. (La fiche a été vérifiée comme appartenant au compte.)
export async function addLog(
  mediaId: number,
  finishedOn: string | null,
  opts: { rating?: number | null; rewatch?: boolean; source?: string; backloggdPending?: boolean; unknown?: boolean } = {},
): Promise<number | null> {
  if (finishedOn) {
    const dup = await get("SELECT id FROM log WHERE media_id = ? AND finished_on = ?", [mediaId, finishedOn]);
    if (dup) return null;
    // Une date connue remplace la fin « à dater » importée plus tôt (pas une date inconnue choisie).
    await run("DELETE FROM log WHERE media_id = ? AND finished_on IS NULL AND unknown = 0", [mediaId]);
  } else if (!opts.unknown) {
    const any = await get("SELECT id FROM log WHERE media_id = ?", [mediaId]);
    if (any) return null;
  }
  const source = opts.source ?? "app";
  const { id } = await run(
    "INSERT INTO log (media_id, finished_on, rating, rewatch, source, backloggd_pending, unknown, source_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      mediaId, finishedOn, opts.rating ?? null, opts.rewatch ? 1 : 0, source,
      // Backloggd ne prend qu'un jour précis.
      opts.backloggdPending && finishedOn?.length === 10 ? 1 : 0,
      !finishedOn && opts.unknown ? 1 : 0,
      source === "app" ? null : finishedOn,
    ],
  );
  return id;
}

export async function addActivity(mediaId: number, day: string, amount: number, minutes = 0, source = "app") {
  if (source === "app") {
    await run(
      `INSERT INTO activity (media_id, day, amount, minutes, source) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (media_id, day, source) DO UPDATE SET amount = amount + excluded.amount, minutes = minutes + excluded.minutes`,
      [mediaId, day, amount, minutes, source],
    );
  } else {
    // Sources externes : la valeur lue fait foi (un nouvel import ne doit pas l'additionner).
    await run(
      `INSERT INTO activity (media_id, day, amount, minutes, source) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (media_id, day, source) DO UPDATE SET amount = excluded.amount, minutes = excluded.minutes`,
      [mediaId, day, amount, minutes, source],
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Imports en masse (listes AniList de milliers d'entrées, export Letterboxd complet) : tout est
// résolu en mémoire puis écrit en quelques batchs, au lieu de plusieurs allers-retours par entrée
// — sur Turso, chacun coûte un aller-retour réseau.

export type BulkItem = {
  media: MediaInput;
  overwrite?: (keyof MediaInput)[];
  finishes?: { day: string | null; rating?: number | null; rewatch?: boolean; source: string }[];
  activity?: { day: string; amount: number; minutes: number; source: string }[];
  // Ajustement final de la fiche selon son état (ex. jeu du journal Backloggd : prévu → en cours).
  after?: (row: Media, finished: boolean) => Partial<Pick<Media, "status" | "started_on">> | null;
};

class MediaIndex {
  byKey = new Map<string, Media>();
  rows: Media[] = [];
  constructor(rows: Media[]) {
    this.rows = rows;
    for (const r of rows) for (const k of MediaIndex.keys(r)) if (!this.byKey.has(k)) this.byKey.set(k, r);
  }
  // Mêmes règles que findMedia : identifiants externes d'abord, puis titre + année pour films et jeux.
  static keys(m: MediaInput | Media): string[] {
    const out: string[] = [];
    if (m.anilist_id != null) out.push(`al:${m.anilist_id}`);
    if (m.letterboxd_slug && !m.letterboxd_slug.startsWith("?")) out.push(`lb:${m.letterboxd_slug}`);
    if (m.backloggd_slug) out.push(`bl:${m.kind}:${m.backloggd_slug}`);
    if (m.tvmaze_id != null) out.push(`tv:${m.tvmaze_id}`);
    if (m.kind === "film" && m.tmdb_id != null) out.push(`tmdb:${m.tmdb_id}`);
    if (m.steam_id != null) out.push(`steam:${m.kind}:${m.steam_id}`);
    if (m.isbn) out.push(`isbn:${m.isbn}`);
    return out;
  }
  find(m: MediaInput): Media | undefined {
    for (const k of MediaIndex.keys(m)) {
      const r = this.byKey.get(k);
      if (r && r.kind === m.kind) return r;
    }
    if (m.kind === "film" || m.kind === "jeu") {
      const t = m.title.toLowerCase();
      return this.rows.find((r) => r.kind === m.kind && r.title.toLowerCase() === t && (m.year == null || r.year == null || r.year === m.year));
    }
  }
}

export async function bulkUpsert(uid: number, items: BulkItem[]): Promise<{ created: number; logs: number }> {
  const kinds = [...new Set(items.map((i) => i.media.kind))];
  if (!kinds.length) return { created: 0, logs: 0 };
  const load = async () =>
    new MediaIndex(
      await all<Media>(`SELECT * FROM media WHERE user_id = ? AND kind IN (${kinds.map(() => "?").join(",")})`, [uid, ...kinds]),
    );

  // 1. Fiches nouvelles (dédoublonnées au sein du lot), insérées d'un coup.
  let index = await load();
  const fresh = new MediaIndex([]);
  const inserts: Stmt[] = [];
  for (const it of items) {
    if (index.find(it.media) || fresh.find(it.media)) continue;
    const row = { ...it.media } as unknown as Media;
    fresh.rows.push(row);
    for (const k of MediaIndex.keys(row)) fresh.byKey.set(k, row);
    const cols = MEDIA_COLUMNS.filter((c) => it.media[c] !== undefined);
    inserts.push({
      sql: `INSERT INTO media (user_id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`,
      args: [uid, ...cols.map((c) => (it.media[c] ?? null) as InValue)],
    });
  }
  await batch(inserts);
  if (inserts.length) index = await load();

  // 2. Fins déjà connues, pour appliquer les règles d'addLog sans requête par entrée.
  const logs = await all<{ media_id: number; finished_on: string | null; source: string; source_day: string | null; unknown: number }>(
    "SELECT log.media_id, log.finished_on, log.source, log.source_day, log.unknown FROM log JOIN media ON media.id = log.media_id WHERE media.user_id = ?",
    [uid],
  );
  const dated = new Set(logs.filter((l) => l.finished_on).map((l) => `${l.media_id}|${l.finished_on}`));
  // Fins déjà importées, reconnues par la date d'origine même si elles ont été corrigées depuis.
  const fromSource = new Set(logs.filter((l) => l.source_day).map((l) => `${l.media_id}|${l.source}|${l.source_day}`));
  const hasAny = new Set(logs.map((l) => l.media_id));
  const hasUndated = new Set(logs.filter((l) => !l.finished_on && !l.unknown).map((l) => l.media_id));

  const writes: Stmt[] = [];
  let logCount = 0;
  for (const it of items) {
    const row = index.find(it.media);
    if (!row) continue;
    // Mise à jour des champs, mêmes règles qu'upsertMedia.
    const sets: string[] = [];
    const args: InValue[] = [];
    for (const c of MEDIA_COLUMNS) {
      const v = it.media[c];
      if (v === undefined || v === null || v === "") continue;
      const cur = row[c];
      const empty = cur === null || cur === "" || (typeof cur === "string" && cur.startsWith("?"));
      if ((it.overwrite?.includes(c) || empty || (c === "total" && cur !== v)) && cur !== v) {
        sets.push(`${c} = ?`);
        args.push(v as InValue);
        (row as Record<string, unknown>)[c] = v;
      }
    }
    let finished = false;
    for (const f of it.finishes ?? []) {
      if (f.day) {
        const key = `${row.id}|${f.day}`;
        const src = `${row.id}|${f.source}|${f.day}`;
        if (dated.has(key) || fromSource.has(src)) continue;
        dated.add(key);
        fromSource.add(src);
        if (hasUndated.has(row.id)) {
          writes.push({ sql: "DELETE FROM log WHERE media_id = ? AND finished_on IS NULL AND unknown = 0", args: [row.id] });
          hasUndated.delete(row.id);
        }
      } else if (hasAny.has(row.id)) continue;
      else hasUndated.add(row.id);
      hasAny.add(row.id);
      finished = true;
      logCount++;
      writes.push({
        sql: "INSERT INTO log (media_id, finished_on, rating, rewatch, source, source_day) VALUES (?, ?, ?, ?, ?, ?)",
        args: [row.id, f.day, f.rating ?? null, f.rewatch ? 1 : 0, f.source, f.day],
      });
    }
    for (const a of it.activity ?? []) {
      writes.push({
        sql: `INSERT INTO activity (media_id, day, amount, minutes, source) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (media_id, day, source) DO UPDATE SET amount = excluded.amount, minutes = excluded.minutes`,
        args: [row.id, a.day, a.amount, a.minutes, a.source],
      });
    }
    const extra = it.after?.(row, finished || (it.finishes?.length ?? 0) > 0);
    for (const [c, v] of Object.entries(extra ?? {})) {
      if (row[c as keyof Media] === v) continue;
      sets.push(`${c} = ?`);
      args.push(v as InValue);
      (row as Record<string, unknown>)[c] = v;
    }
    if (sets.length) {
      writes.push({ sql: `UPDATE media SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`, args: [...args, row.id] });
    }
  }
  await batch(writes);
  return { created: inserts.length, logs: logCount };
}

export async function deleteMedia(uid: number, id: number) {
  if (!(await getMedia(uid, id))) return;
  // Suppression explicite des lignes liées : PRAGMA foreign_keys n'est pas garanti sur toutes les bases.
  await batch([
    { sql: "DELETE FROM log WHERE media_id = ?", args: [id] },
    { sql: "DELETE FROM activity WHERE media_id = ?", args: [id] },
    { sql: "DELETE FROM link WHERE media_id = ?", args: [id] },
    { sql: "DELETE FROM alias WHERE media_id = ?", args: [id] },
    { sql: "DELETE FROM event WHERE media_id = ? AND user_id = ?", args: [id, uid] },
    { sql: "DELETE FROM media WHERE id = ? AND user_id = ?", args: [id, uid] },
  ]);
}
