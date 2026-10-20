import "server-only";
import { all, batch, bulkUpsert, get, getSetting, run, setSetting, type BulkItem, type Media, type Stmt } from "@/lib/db";
import { FAV_MAX, normTitle, type Status } from "@/lib/kinds";
import { eventsFromImport } from "@/lib/events";
import { importAnilistActivity } from "@/lib/activity";
import { syncMalCovers } from "@/lib/mal";
import {
  STATUS_FROM_ANILIST, fetchProfileExtras, fetchRelations, fetchUserLists, fuzzyToIso, mediaFields, saveEntry, viewerName,
} from "@/lib/anilist";
import { fetchRss, lookupFilm, type FilmWatch } from "@/lib/letterboxd";

// Horodatage SQLite (« AAAA-MM-JJ HH:MM:SS », UTC) du début d'un import, pour retrouver ce qu'il a ajouté.
const sqlNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

export type SyncReport = { created: number; logs: number; message?: string };

// ---------------------------------------------------------------------------------------------
// AniList → appli. AniList fait foi pour le statut, la progression et la note des œuvres qu'il suit :
// les changements faits dans l'appli y sont renvoyés aussitôt (pushAniList), les deux restent alignés.

export async function syncAniList(uid: number): Promise<SyncReport> {
  let user = await getSetting(uid, "anilist_user");
  const token = await getSetting(uid, "anilist_token");
  if (!user && token) {
    user = await viewerName(token);
    await setSetting(uid, "anilist_user", user);
  }
  if (!user) throw new Error("Renseigne ton pseudo AniList dans Réglages.");
  const startedAt = sqlNow();
  const entries = await fetchUserLists(user);
  // Fiches modifiées dans l'appli et pas encore renvoyées : AniList n'est pas encore à jour, on ne l'écoute pas.
  const dirty = new Set(
    (await all<{ anilist_id: number }>("SELECT anilist_id FROM media WHERE user_id = ? AND anilist_dirty = 1 AND anilist_id IS NOT NULL", [uid])).map(
      (r) => r.anilist_id,
    ),
  );
  const items: BulkItem[] = entries.map((e) => {
    const fields = mediaFields(e.media);
    const completedAt = fuzzyToIso(e.completedAt);
    const finished = e.status === "COMPLETED" || (e.status === "REPEATING" && completedAt);
    return {
      media: {
        ...fields,
        status: STATUS_FROM_ANILIST[e.status] ?? "prevu",
        progress: (fields.kind === "ln" ? e.progressVolumes : e.progress) ?? 0,
        rating: e.score ? e.score : null,
        started_on: fuzzyToIso(e.startedAt),
        notes: e.notes?.trim() || undefined,
      },
      // Titre et couverture ne sont que complétés : ils ont pu être changés à la main.
      overwrite: dirty.has(fields.anilist_id) ? [] : ["status", "progress", "rating", "started_on"],
      finishes: finished ? [{ day: completedAt, rating: e.score || null, source: "anilist" }] : [],
    };
  });
  const { created, logs } = await bulkUpsert(uid, items);
  await setSetting(uid, "anilist_synced_at", new Date().toISOString());
  await importAnilistExtras(uid, user).catch(() => {});
  await syncRelations().catch(() => {});
  await syncVnAliases(uid).catch(() => {});
  await eventsFromImport(uid, startedAt).catch(() => {});
  await importAnilistActivity(uid, 3).catch(() => {});
  await syncMalCovers(uid, 10000).catch(() => {});
  return { created, logs, message: `${entries.length} entrées lues sur AniList (${user})` };
}

// Favoris AniList (cœur dans la grille ; les 5 premiers de chaque type deviennent favoris du profil s'il n'en a
// pas encore) et critiques publiées (texte et note).
async function importAnilistExtras(uid: number, user: string) {
  const { favourites, reviews } = await fetchProfileExtras(user);
  const stmts: Stmt[] = [];
  const favIds = [...favourites.anime, ...favourites.manga];
  if (favIds.length) {
    stmts.push({
      sql: `UPDATE media SET liked = 1 WHERE user_id = ? AND anilist_id IN (${favIds.map(() => "?").join(",")})`,
      args: [uid, ...favIds],
    });
  }
  // Rangs par type réel : la liste « manga » d'AniList mêle mangas et light novels.
  const favRows = favIds.length
    ? await all<{ anilist_id: number; kind: string; fav_rank: number | null }>(
        `SELECT anilist_id, kind, fav_rank FROM media WHERE user_id = ? AND anilist_id IN (${favIds.map(() => "?").join(",")})`,
        [uid, ...favIds],
      )
    : [];
  // Favoris (liste commune à tous les types) : complétés à la suite, tant que la liste n'a pas été modifiée
  // dans l'appli.
  const already = new Set(favRows.filter((r) => r.fav_rank != null).map((r) => r.anilist_id));
  stmts.push(...(await appendFavorites(uid, favIds.filter((id) => favRows.some((r) => r.anilist_id === id) && !already.has(id)), "anilist_id")));
  for (const r of reviews) {
    const text = [r.summary, r.body].filter(Boolean).join("\n\n").trim();
    stmts.push({
      sql: "UPDATE media SET review = ?, rating = COALESCE(rating, ?) WHERE user_id = ? AND anilist_id = ? AND review = ''",
      args: [text, r.score ? r.score / 10 : null, uid, r.mediaId],
    });
  }
  await batch(stmts);
}

// Relations AniList (communes à tous les comptes) des fiches qui ne les ont pas encore, puis des œuvres hors
// bibliothèque qui les relient entre elles (chaînes de films, OAV qui mènent à une série) sur quelques niveaux.
export async function syncRelations(onlyIds?: number[]): Promise<number> {
  const rows = onlyIds
    ? onlyIds.map((anilist_id) => ({ anilist_id }))
    : await all<{ anilist_id: number }>(
        "SELECT DISTINCT anilist_id FROM media WHERE anilist_id IS NOT NULL AND (relations_at IS NULL OR aliases_at IS NULL)",
      );
  const ids = rows.map((r) => r.anilist_id);
  if (ids.length) await storeRelations(ids, true);
  await expandRelations(3).catch(() => {});
  return ids.length;
}

async function storeRelations(ids: number[], inLibrary: boolean) {
  const { relations, info } = await fetchRelations(ids);
  const stmts: Stmt[] = ids.map((id) => ({ sql: "DELETE FROM relation WHERE anilist_id = ?", args: [id] }));
  for (const r of relations) {
    stmts.push({ sql: "INSERT OR IGNORE INTO relation (anilist_id, target_id, type) VALUES (?, ?, ?)", args: [r.id, r.target, r.type] });
  }
  for (const m of info) {
    stmts.push({
      sql: `INSERT INTO relation_node (anilist_id, format, title) VALUES (?, ?, ?)
            ON CONFLICT (anilist_id) DO UPDATE SET format = excluded.format, title = excluded.title, fetched_at = datetime('now')`,
      args: [m.id, m.format, m.titles[0] ?? ""],
    });
    if (!inLibrary) continue;
    stmts.push({ sql: "DELETE FROM alias WHERE media_id IN (SELECT id FROM media WHERE anilist_id = ?)", args: [m.id] });
    for (const t of m.titles) {
      stmts.push({ sql: "INSERT OR IGNORE INTO alias (media_id, title) SELECT id, ? FROM media WHERE anilist_id = ?", args: [t, m.id] });
    }
    stmts.push({ sql: "UPDATE media SET source = ?, format = COALESCE(format, ?) WHERE anilist_id = ?", args: [m.source, m.format, m.id] });
  }
  if (inLibrary) {
    for (const id of ids) {
      stmts.push({ sql: "UPDATE media SET relations_at = datetime('now'), aliases_at = datetime('now') WHERE anilist_id = ?", args: [id] });
    }
  }
  await batch(stmts);
}

// Œuvres hors bibliothèque reliées (PREQUEL, SEQUEL, PARENT, ALTERNATIVE, SOURCE) à une œuvre dont on suit
// la chaîne : sans elles, un film comme Code Geass : Fukkatsu no Lelouch ne rejoint pas sa série.
async function expandRelations(depth: number) {
  for (let level = 0; level < depth; level++) {
    const next = await all<{ target_id: number }>(
      `SELECT DISTINCT r.target_id FROM relation r
       WHERE r.type IN ('PREQUEL', 'SEQUEL', 'PARENT', 'ALTERNATIVE', 'SOURCE')
         AND NOT EXISTS (SELECT 1 FROM relation_node n WHERE n.anilist_id = r.target_id)
         AND NOT EXISTS (SELECT 1 FROM media m WHERE m.anilist_id = r.target_id AND m.relations_at IS NOT NULL)
       LIMIT 150`,
    );
    if (!next.length) return;
    await storeRelations(next.map((n) => n.target_id), false);
  }
}

// Titres VNDB des jeux vus d'un compte (tout statut sauf « Prévu ») : un jeu absent de VNDB n'est pas un visual
// novel. Les autres jeux gardent leur seul titre, qui sert aux adaptations de jeux vidéo.
// VNDB limite à 200 requêtes par 5 minutes : le reste attendra la synchro suivante.
export async function syncVnAliases(uid: number, budgetMs = 15000): Promise<number> {
  const games = await all<Media>(
    "SELECT * FROM media WHERE user_id = ? AND kind = 'jeu' AND status <> 'prevu' AND aliases_at IS NULL ORDER BY updated_at DESC LIMIT 150",
    [uid],
  );
  const start = Date.now();
  let done = 0;
  for (const g of games) {
    if (Date.now() - start > budgetMs) break;
    const titles = await vndbTitles(g.title).catch(() => null);
    if (titles === null) break; // VNDB injoignable ou limite atteinte : on réessaiera
    const stmts: Stmt[] = [{ sql: "DELETE FROM alias WHERE media_id = ?", args: [g.id] }];
    for (const t of new Set([g.title, ...titles])) stmts.push({ sql: "INSERT OR IGNORE INTO alias (media_id, title) VALUES (?, ?)", args: [g.id, t] });
    stmts.push({
      sql: "UPDATE media SET aliases_at = datetime('now'), source = ? WHERE id = ?",
      args: [titles.length ? "VISUAL_NOVEL" : null, g.id],
    });
    await batch(stmts);
    done++;
  }
  return done;
}

const words = (t: string) => t.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 || /\d/.test(w));

// Titres du VN qui correspond à ce jeu. La recherche VNDB est large (« Chaos;Head Noah » renvoie d'abord
// CHAOS;CHILD, « Undertale » des fan-VN) : parmi les 10 premiers résultats, on garde celui dont un titre est
// identique à celui du jeu ; à défaut, un titre qui le prolonge ou qui en partage les mots principaux
// (« Wonderful Everyday ~Diskontinuierliches Dasein~ » pour « Wonderful Everyday: Down the Rabbit-Hole »),
// seulement pour un VN assez connu pour écarter les fan-VN au nom proche.
async function vndbTitles(title: string): Promise<string[]> {
  return (await vndbMatch(title))?.titles ?? [];
}

// Le VN qui correspond à ce titre de jeu (id VNDB et tous ses titres), ou null.
export async function vndbMatch(title: string): Promise<{ id: string; titles: string[] } | null> {
  const res = await fetch("https://api.vndb.org/kana/vn", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Almanach/0.1" },
    body: JSON.stringify({
      filters: ["search", "=", title],
      fields: "id, title, alttitle, titles.title, titles.latin, aliases, votecount",
      results: 10,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`VNDB : HTTP ${res.status}`);
  const data = (await res.json()) as {
    results: { id: string; title: string; alttitle: string | null; titles: { title: string; latin: string | null }[]; aliases: string[]; votecount: number }[];
  };
  const own = normTitle(title);
  const ownWords = words(title.split(":")[0]);
  let best: { id: string; titles: string[]; score: number } | null = null;
  for (const vn of data.results) {
    const titles = [vn.title, vn.alttitle, ...vn.titles.flatMap((t) => [t.title, t.latin]), ...vn.aliases].filter((t): t is string => Boolean(t));
    const norms = titles.map(normTitle);
    const exact = norms.includes(own);
    const prefix = own.length >= 4 && vn.votecount >= 50 && norms.some((n) => n.startsWith(own) || (n.length >= 4 && own.startsWith(n)));
    // Mots principaux (avant « : ») tous présents dans l'un des titres, pour un VN très connu.
    const shared = ownWords.length >= 2 && vn.votecount >= 300 && titles.some((t) => ownWords.every((w) => words(t).includes(w)));
    const score = exact ? 1_000_000 + vn.votecount : prefix || shared ? vn.votecount : 0;
    if (score > (best?.score ?? 0)) best = { id: vn.id, titles: [...new Set(titles)], score };
  }
  return best ? { id: best.id, titles: best.titles } : null;
}

export async function pushAniList(media: Media): Promise<string | null> {
  if (!media.anilist_id) return null;
  const token = await getSetting(media.user_id, "anilist_token");
  if (!token) return null;
  const last = await get<{ finished_on: string | null }>(
    "SELECT finished_on FROM log WHERE media_id = ? AND finished_on IS NOT NULL ORDER BY finished_on DESC LIMIT 1",
    [media.id],
  );
  try {
    await run("UPDATE media SET anilist_dirty = 1 WHERE id = ?", [media.id]);
    await saveEntry(token, {
      mediaId: media.anilist_id,
      kind: media.kind,
      status: media.status,
      progress: media.progress,
      rating: media.rating,
      startedOn: media.started_on,
      finishedOn: media.status === "termine" ? (last?.finished_on ?? null) : null,
    });
    await run("UPDATE media SET anilist_dirty = 0 WHERE id = ?", [media.id]);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// Renvoie sur AniList les fiches en attente (changements en masse), dans un temps limité : AniList
// plafonne le débit (~30 à 90 requêtes par minute) et une action serveur ne doit pas durer trop longtemps.
export async function pushPendingAniList(uid: number, budgetMs = 20000): Promise<{ sent: number; left: number; error?: string }> {
  const token = await getSetting(uid, "anilist_token");
  const pending = await all<Media>("SELECT * FROM media WHERE user_id = ? AND anilist_dirty = 1 AND anilist_id IS NOT NULL ORDER BY updated_at", [uid]);
  if (!token) return { sent: 0, left: pending.length };
  const start = Date.now();
  let sent = 0;
  for (const m of pending) {
    if (Date.now() - start > budgetMs) break;
    const err = await pushAniList(m);
    if (err) return { sent, left: pending.length - sent, error: err };
    sent++;
  }
  return { sent, left: pending.length - sent };
}

export async function pendingAniListCount(uid: number): Promise<number> {
  return (await get<{ n: number }>("SELECT COUNT(*) AS n FROM media WHERE user_id = ? AND anilist_dirty = 1 AND anilist_id IS NOT NULL", [uid]))?.n ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Letterboxd → appli (lecture seule).

export async function importFilms(uid: number, watches: FilmWatch[]): Promise<SyncReport> {
  const startedAt = sqlNow();
  // Du plus ancien au plus récent : la note gardée sur la fiche est la dernière donnée.
  const items: BulkItem[] = [...watches]
    .sort((a, b) => a.watchedOn.localeCompare(b.watchedOn))
    .map((w) => ({
      media: {
        kind: "film",
        title: w.title,
        year: w.year,
        cover: w.poster || undefined,
        letterboxd_slug: w.slug ?? undefined,
        tmdb_id: w.tmdbId ?? undefined,
        status: "termine",
        rating: w.rating,
        liked: w.liked ? 1 : undefined,
        review: w.review || undefined,
      },
      overwrite: ["status", ...(w.rating != null ? (["rating"] as const) : []), ...(w.review ? (["review"] as const) : [])],
      finishes: [{ day: w.watchedOn, rating: w.rating, rewatch: w.rewatch, source: "letterboxd" }],
    }));
  const report = await bulkUpsert(uid, items);
  await eventsFromImport(uid, startedAt);
  return report;
}

export async function syncLetterboxd(uid: number): Promise<SyncReport> {
  const user = await getSetting(uid, "letterboxd_user");
  if (!user) throw new Error("Renseigne ton pseudo Letterboxd dans Réglages.");
  const report = await importFilms(uid, await fetchRss(user));
  await setSetting(uid, "letterboxd_synced_at", new Date().toISOString());
  return { ...report, message: "Flux RSS lu (les ~50 derniers films ; l'historique complet passe par l'import CSV)" };
}

// Films importés du CSV : affiche, slug et id TMDB depuis leur page Letterboxd, par petits lots.
export async function completeFilmPosters(uid: number, limit = 12): Promise<number> {
  const films = await all<Media>("SELECT * FROM media WHERE user_id = ? AND kind = 'film' AND cover = '' AND letterboxd_slug IS NULL LIMIT ?", [uid, limit]);
  let done = 0;
  for (const f of films) {
    const found = await lookupFilm(f.title, f.year).catch(() => null);
    if (!found) {
      // Marque l'échec pour ne pas réessayer en boucle ; la fiche reste modifiable à la main.
      await run("UPDATE media SET letterboxd_slug = ? WHERE id = ?", [`?${f.id}`, f.id]);
      continue;
    }
    const clash = await get("SELECT id FROM media WHERE user_id = ? AND letterboxd_slug = ? AND id <> ?", [uid, found.slug, f.id]);
    await run("UPDATE media SET cover = ?, letterboxd_slug = ?, tmdb_id = COALESCE(tmdb_id, ?) WHERE id = ?", [
      found.poster,
      clash ? `?${f.id}` : found.slug,
      found.tmdbId,
      f.id,
    ]);
    done++;
  }
  return done;
}

// ---------------------------------------------------------------------------------------------
// Backloggd ↔ appli. Le journal, les listes, les jeux aimés et les favoris passent par le compagnon local
// (scripts/backloggd.mjs, vrai navigateur) ; les critiques récentes, par le flux RSS public, lu ici.

export type BackloggdEntry = {
  slug: string;
  title: string;
  cover?: string;
  day: string; // AAAA-MM-JJ
  minutes?: number;
  rating?: number; // sur 10
  started?: boolean;
  finished?: boolean;
};

export async function importBackloggd(uid: number, entries: BackloggdEntry[]): Promise<SyncReport> {
  const startedAt = sqlNow();
  const items: BulkItem[] = [...entries]
    .filter((e) => e.slug && e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.day))
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((e) => ({
      media: { kind: "jeu", title: e.title, cover: e.cover || undefined, backloggd_slug: e.slug, rating: e.rating ?? undefined },
      overwrite: e.rating != null ? ["rating"] : [],
      activity: [{ day: e.day, amount: 0, minutes: e.minutes ?? 0, source: "backloggd" }],
      finishes: e.finished ? [{ day: e.day, rating: e.rating ?? null, source: "backloggd" }] : [],
      after: (row) => ({
        status: e.finished ? "termine" : row.status === "prevu" ? "en_cours" : row.status,
        started_on: !row.started_on || e.day < row.started_on ? e.day : row.started_on,
      }),
    }));
  const report = await bulkUpsert(uid, items);
  await eventsFromImport(uid, startedAt);
  await setSetting(uid, "backloggd_synced_at", new Date().toISOString());
  return report;
}

// Listes de jeux du profil Backloggd : Backlog → prévu, Playing → en cours, Liked → cœur, Favorites → favoris
// du profil (dans l'ordre ; le premier porte la couronne). Un jeu déjà plus avancé dans l'appli garde son statut.
export type BackloggdListEntry = {
  slug: string;
  title: string;
  cover?: string;
  list: "backlog" | "playing" | "played" | "liked" | "favorites";
  rank?: number;
  status?: string; // liste Played : completed, played, retired, shelved ou abandoned
  rating?: number; // note du profil, sur 10
};

// Statut Backloggd d'un jeu joué → statut Almanach.
const PLAYED_STATUS: Record<string, Status> = { completed: "termine", played: "termine", retired: "termine", shelved: "pause", abandoned: "abandonne" };

// Favoris importés : ajoutés à la suite de la liste commune (FAV_MAX au plus), seulement si elle n'a jamais été
// modifiée dans l'appli.
async function appendFavorites(uid: number, keys: (number | string)[], column: "anilist_id" | "backloggd_slug"): Promise<Stmt[]> {
  if (!keys.length || (await getSetting(uid, "favs_edited"))) return [];
  const count = (await get<{ n: number }>("SELECT COUNT(*) AS n FROM media WHERE user_id = ? AND fav_rank IS NOT NULL", [uid]))?.n ?? 0;
  return keys.slice(0, Math.max(0, FAV_MAX - count)).map((k, i) => ({
    sql: `UPDATE media SET fav_rank = ? WHERE user_id = ? AND ${column} = ? AND fav_rank IS NULL`,
    args: [count + i + 1, uid, k],
  }));
}

export async function importBackloggdLists(uid: number, entries: BackloggdListEntry[]): Promise<SyncReport> {
  const valid = entries.filter((e) => e.slug && e.title);
  const items: BulkItem[] = valid
    .filter((e) => e.list === "backlog" || e.list === "playing")
    .map((e) => ({
      media: { kind: "jeu", title: e.title, cover: e.cover || undefined, backloggd_slug: e.slug, status: e.list === "playing" ? "en_cours" : "prevu" },
      after: (row) => (e.list === "playing" && (row.status === "prevu" || row.status === "pause") ? { status: "en_cours" } : null),
    }));
  // Liste Played : tous les jeux joués, même sans journal ni critique. Statut repris de Backloggd (un jeu déjà
  // terminé dans l'appli le reste) ; pas de fin inventée : la date vient du journal ou des critiques.
  for (const e of valid.filter((v) => v.list === "played")) {
    const status = PLAYED_STATUS[e.status ?? ""] ?? "termine";
    items.push({
      media: { kind: "jeu", title: e.title, cover: e.cover || undefined, backloggd_slug: e.slug, status, rating: e.rating || undefined },
      after: (row) => (row.status !== status && row.status !== "termine" ? { status } : null),
    });
  }
  // Jeux aimés et favoris : la fiche est créée au besoin (terminée, puisqu'aimée), puis marquée.
  for (const e of valid.filter((v) => v.list === "liked" || v.list === "favorites")) {
    items.push({ media: { kind: "jeu", title: e.title, cover: e.cover || undefined, backloggd_slug: e.slug, status: "termine" } });
  }
  const report = await bulkUpsert(uid, items);
  const stmts: Stmt[] = [];
  const liked = valid.filter((e) => e.list === "liked").map((e) => e.slug);
  if (liked.length) {
    stmts.push({ sql: `UPDATE media SET liked = 1 WHERE user_id = ? AND backloggd_slug IN (${liked.map(() => "?").join(",")})`, args: [uid, ...liked] });
  }
  const favs = valid.filter((e) => e.list === "favorites").sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  if (favs.length) {
    const already = new Set(
      (await all<{ slug: string }>("SELECT backloggd_slug AS slug FROM media WHERE user_id = ? AND fav_rank IS NOT NULL AND backloggd_slug IS NOT NULL", [uid])).map((r) => r.slug),
    );
    stmts.push(...(await appendFavorites(uid, favs.map((f) => f.slug).filter((s) => !already.has(s)), "backloggd_slug")));
  }
  await batch(stmts);
  return report;
}

// Toutes les critiques du profil Backloggd, lues par le compagnon sur la page Reviews. Faute de journal, la date
// de la critique devient la date de fin des jeux terminés (Completed, Played, Retired), seulement s'ils n'ont
// encore aucune fin : le journal et l'appli restent prioritaires.
export type BackloggdReview = {
  slug: string;
  title: string;
  cover?: string;
  day: string; // AAAA-MM-JJ
  rating?: number; // sur 10
  status?: string; // statut Backloggd affiché sur la critique
  text: string;
};

const REVIEW_STATUS: Record<string, Status> = {
  completed: "termine",
  played: "termine",
  retired: "termine",
  shelved: "pause",
  abandoned: "abandonne",
};

export async function importBackloggdReviews(uid: number, reviews: BackloggdReview[]): Promise<SyncReport> {
  const startedAt = sqlNow();
  const alreadyFinished = new Set(
    (
      await all<{ slug: string }>(
        "SELECT DISTINCT media.backloggd_slug AS slug FROM media JOIN log ON log.media_id = media.id WHERE media.user_id = ? AND media.backloggd_slug IS NOT NULL",
        [uid],
      )
    ).map((r) => r.slug),
  );
  const items: BulkItem[] = reviews
    .filter((r) => r.slug && r.title && /^\d{4}-\d{2}-\d{2}$/.test(r.day))
    .map((r) => {
      const status = REVIEW_STATUS[r.status?.toLowerCase() ?? ""];
      const finished = status === "termine" && !alreadyFinished.has(r.slug);
      return {
        media: { kind: "jeu", title: r.title, cover: r.cover || undefined, backloggd_slug: r.slug, rating: r.rating, review: r.text || undefined },
        overwrite: ["rating", "review"],
        finishes: finished ? [{ day: r.day, rating: r.rating ?? null, source: "backloggd" }] : [],
        after: (row) => (status && status !== row.status ? { status } : null),
      };
    });
  const report = await bulkUpsert(uid, items);
  await eventsFromImport(uid, startedAt);
  return report;
}

// Critiques Backloggd récentes, depuis le flux RSS public du profil (20 dernières). Le jeu est retrouvé par
// sa jaquette IGDB (celle de la fiche importée), sinon par son titre.
export async function syncBackloggdReviews(uid: number): Promise<number> {
  const user = await getSetting(uid, "backloggd_user");
  if (!user) return 0;
  const res = await fetch(`https://backloggd.com/u/${encodeURIComponent(user)}/reviews/rss/`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Almanach/0.1)" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return 0;
  const xml = await res.text();
  const decode = (s: string) =>
    s.replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
  let n = 0;
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = decode(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").replace(/\s*\(\d{4}\)\s*-\s*[★½\s]*$/, "").trim();
    const text = decode(item.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? "").trim();
    const rating = Number(item.match(/<backloggd:user_rating>(\d+)<\/backloggd:user_rating>/)?.[1]) || null;
    const cover = item.match(/<url>([^<]+)<\/url>/)?.[1] ?? "";
    if (!text) continue;
    const coverKey = cover.replace(/^.*\/(co[a-z0-9]+)\.\w+$/, "$1");
    const media =
      (coverKey && (await get<Media>("SELECT * FROM media WHERE user_id = ? AND kind = 'jeu' AND cover LIKE ?", [uid, `%/${coverKey}.%`]))) ||
      (await get<Media>("SELECT * FROM media WHERE user_id = ? AND kind = 'jeu' AND lower(title) = lower(?)", [uid, title]));
    if (!media) continue;
    await run("UPDATE media SET review = ?, rating = COALESCE(rating, ?) WHERE id = ?", [text, rating, media.id]);
    n++;
  }
  return n;
}

// Fins de jeux faites dans l'appli, à écrire dans le journal Backloggd.
export async function pendingBackloggd(uid: number) {
  return all<{ log_id: number; media_id: number; title: string; slug: string | null; finished_on: string; started_on: string | null }>(
    `SELECT log.id AS log_id, media.id AS media_id, media.title, media.backloggd_slug AS slug, log.finished_on, media.started_on
     FROM log JOIN media ON media.id = log.media_id
     WHERE media.user_id = ? AND log.backloggd_pending = 1 AND length(log.finished_on) = 10 ORDER BY log.finished_on`,
    [uid],
  );
}

export async function markBackloggdDone(uid: number, results: { log_id: number; slug?: string }[]) {
  for (const r of results) {
    const own = await get<{ media_id: number }>("SELECT log.media_id FROM log JOIN media ON media.id = log.media_id WHERE log.id = ? AND media.user_id = ?", [
      r.log_id,
      uid,
    ]);
    if (!own) continue;
    await run("UPDATE log SET backloggd_pending = 0 WHERE id = ?", [r.log_id]);
    if (r.slug) {
      await run(
        "UPDATE media SET backloggd_slug = ? WHERE id = ? AND backloggd_slug IS NULL AND NOT EXISTS (SELECT 1 FROM media WHERE user_id = ? AND backloggd_slug = ?)",
        [r.slug, own.media_id, uid, r.slug],
      );
    }
  }
}
