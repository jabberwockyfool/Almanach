import "server-only";
import { all, get, getSetting, setSetting } from "@/lib/db";
import { addEvents, backfillEvents, readFeed, type EventType, type FeedItem, type NewEvent } from "@/lib/events";
import { syncSteam } from "@/lib/steam";

// Fil d'activité de l'accueil, d'après le journal d'événements d'Almanach : celui du compte connecté, ou de
// tous les comptes. Lire le fil relance au besoin, sans bloquer, l'import de l'activité AniList du compte
// (toutes les 2 min) et sa synchro Steam (toutes les 10 min) : ce qui en sort apparaît au rafraîchissement suivant.

export type { FeedItem };

const last = new Map<string, number>();
function due(key: string, everyMs: number): boolean {
  const t = last.get(key) ?? 0;
  if (Date.now() - t < everyMs) return false;
  last.set(key, Date.now());
  return true;
}

type ListActivity = {
  id: number;
  status: string;
  progress: string | null;
  createdAt: number;
  media: { id: number; type: "ANIME" | "MANGA"; title: { userPreferred: string }; coverImage: { large: string } } | null;
};

function mapStatus(status: string, progress: string | null): { type: EventType; data: object } | null {
  const [from, to] = (progress ?? "").split("-").map((s) => Number(s.trim()));
  // AniList compte en épisodes ou en chapitres (même pour les light novels) : son unité fait foi.
  const unit = status.includes("episode") ? "épisode" : status.includes("chapter") ? "chapitre" : undefined;
  const range = progress ? { from, to: Number.isFinite(to) ? to : from, unit } : {};
  switch (status) {
    case "watched episode":
    case "read chapter":
    case "rewatched episode":
    case "reread chapter":
      return { type: "progress", data: range };
    case "completed":
      return { type: "finish", data: {} };
    case "rewatched":
    case "reread":
      return { type: "finish", data: { rewatch: true } };
    case "plans to watch":
    case "plans to read":
      return { type: "plan", data: {} };
    case "dropped":
      return { type: "drop", data: {} };
    case "paused watching":
    case "paused reading":
      return { type: "pause", data: {} };
    default:
      return null;
  }
}

// Activité AniList du compte (épisodes vus sur le site ou une autre appli), avec ses vraies heures.
export async function importAnilistActivity(uid: number, pages = 1): Promise<number> {
  const name = await getSetting(uid, "anilist_user");
  if (!name) return 0;
  const gql = async <T,>(query: string, variables: object): Promise<T> => {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    return ((await res.json()) as { data: T }).data;
  };
  const user = await gql<{ User: { id: number; avatar: { medium: string } } }>(
    "query ($n: String) { User(name: $n) { id avatar { medium } } }",
    { n: name },
  );
  if (user.User.avatar?.medium && (await getSetting(uid, "avatar")) !== user.User.avatar.medium) await setSetting(uid, "avatar", user.User.avatar.medium);
  let added = 0;
  for (let page = 1; page <= pages; page++) {
    const d = await gql<{ Page: { pageInfo: { hasNextPage: boolean }; activities: ListActivity[] } }>(
      `query ($id: Int, $page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage }
        activities(userId: $id, sort: ID_DESC, type_in: [ANIME_LIST, MANGA_LIST]) {
          ... on ListActivity { id status progress createdAt media { id type title { userPreferred } coverImage { large } } } } } }`,
      { id: user.User.id, page },
    );
    const acts = d.Page.activities.filter((a) => a?.media);
    const ids = [...new Set(acts.map((a) => a.media!.id))];
    const local = ids.length
      ? await all<{ id: number; anilist_id: number }>(
          `SELECT id, anilist_id FROM media WHERE user_id = ? AND anilist_id IN (${ids.map(() => "?").join(",")})`,
          [uid, ...ids],
        )
      : [];
    const byAnilist = new Map(local.map((r) => [r.anilist_id, r.id]));
    const events: NewEvent[] = [];
    for (const a of acts) {
      const mapped = mapStatus(a.status, a.progress);
      if (!mapped) continue;
      const mediaId = byAnilist.get(a.media!.id) ?? null;
      // Déjà noté depuis l'appli (puis renvoyé sur AniList), ou fin déjà connue : pas de doublon.
      if (mediaId) {
        const dup =
          mapped.type === "finish"
            ? await get("SELECT id FROM event WHERE user_id = ? AND media_id = ? AND type = 'finish' AND ref NOT LIKE 'al:%' AND abs(at - ?) < 129600", [
                uid,
                mediaId,
                a.createdAt,
              ])
            : await get("SELECT id FROM event WHERE user_id = ? AND media_id = ? AND source = 'app' AND type = ? AND abs(at - ?) < 900", [
                uid,
                mediaId,
                mapped.type,
                a.createdAt,
              ]);
        if (dup) continue;
      }
      events.push({
        at: a.createdAt,
        type: mapped.type,
        media_id: mediaId,
        title: a.media!.title.userPreferred,
        cover: a.media!.coverImage.large,
        // Type gardé pour les œuvres absentes de la bibliothèque (« prévoit de regarder » et non « de jouer à »).
        data: { ...mapped.data, kind: a.media!.type === "ANIME" ? "anime" : "manga" },
        source: "anilist",
        ref: `al:${a.id}`,
      });
    }
    const count = async () => (await get<{ n: number }>("SELECT COUNT(*) AS n FROM event WHERE user_id = ?", [uid]))?.n ?? 0;
    const before = await count();
    await addEvents(uid, events);
    const after = await count();
    added += after - before;
    // Page déjà connue en entier : inutile de remonter plus loin.
    if (after === before || !d.Page.pageInfo.hasNextPage) break;
  }
  return added;
}

// Rafraîchissements de fond du compte connecté, déclenchés par la lecture du fil.
export async function refreshSources(uid: number) {
  if (due(`anilist:${uid}`, 120_000)) await importAnilistActivity(uid, 1).catch(() => {});
  const steamReady = (await getSetting(uid, "steam_user")) && ((await getSetting(uid, "steam_key")) || process.env.STEAM_API_KEY);
  if (steamReady && due(`steam:${uid}`, 600_000)) await syncSteam(uid, 8000).catch(() => {});
}

export async function feed(uid: number, scope: "tous" | "moi", before: { at: number; id: number } | null): Promise<{ items: FeedItem[] }> {
  await backfillEvents(uid);
  return { items: await readFeed(uid, scope === "moi" ? uid : null, before) };
}
