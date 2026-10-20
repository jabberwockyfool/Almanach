import "server-only";
import { all, batch, get, getSetting, setSetting, type Media, type Stmt } from "@/lib/db";
import { addEvents } from "@/lib/events";
import { normTitle } from "@/lib/kinds";

// Steam : temps de jeu et succès pour le fil d'activité.
// L'identifiant se retrouve depuis le pseudo (profil public, ?xml=1) ; le temps de jeu et les succès passent par
// l'API Web de Steam, qui demande une clé (gratuite : steamcommunity.com/dev/apikey). Profil et détails de jeu
// doivent être publics. Steam ne donne qu'un temps total par jeu : la session est la différence entre deux synchros.

const API = "https://api.steampowered.com";
const UA = "Mozilla/5.0 (compatible; Almanach/0.1)";

async function steamId(uid: number, user: string): Promise<string> {
  const cached = await getSetting(uid, "steam_id64");
  const key = `${user}`;
  if (cached && (await getSetting(uid, "steam_id_for")) === key) return cached;
  const u = user.trim().replace(/\/+$/, "");
  let id = u.match(/(\d{17})/)?.[1];
  if (!id) {
    const vanity = u.match(/steamcommunity\.com\/id\/([^/]+)/)?.[1] ?? u;
    const res = await fetch(`https://steamcommunity.com/id/${encodeURIComponent(vanity)}/?xml=1`, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(15000) });
    const xml = await res.text();
    id = xml.match(/<steamID64>(\d+)<\/steamID64>/)?.[1];
    if (!id) throw new Error(`Profil Steam « ${vanity} » introuvable.`);
  }
  await setSetting(uid, "steam_id64", id);
  await setSetting(uid, "steam_id_for", key);
  return id;
}

type OwnedGame = { appid: number; name: string; playtime_forever: number; rtime_last_played?: number };

async function ownedGames(key: string, id: string): Promise<OwnedGame[]> {
  const res = await fetch(
    `${API}/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${id}&include_appinfo=1&include_played_free_games=1&format=json`,
    { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(15000) },
  );
  if (res.status === 401 || res.status === 403) throw new Error("Clé API Steam refusée.");
  if (!res.ok) throw new Error(`Steam : HTTP ${res.status}`);
  const data = (await res.json()) as { response: { games?: OwnedGame[] } };
  if (!data.response.games) throw new Error("Steam ne montre pas tes jeux : rends publics « Détails des jeux » dans la confidentialité du profil.");
  return data.response.games;
}

async function achievements(key: string, id: string, appid: number) {
  const res = await fetch(`${API}/ISteamUserStats/GetPlayerAchievements/v1/?key=${key}&steamid=${id}&appid=${appid}&l=french&format=json`, {
    headers: { "User-Agent": UA },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  // Jeux sans succès : Steam répond 400 « Requested app has no stats ».
  if (!res.ok) return [];
  const data = (await res.json()) as { playerstats?: { achievements?: { achieved: number; unlocktime: number; name?: string; apiname: string }[] } };
  return (data.playerstats?.achievements ?? []).filter((a) => a.achieved && a.unlocktime);
}

// Icônes des succès d'un jeu (la progression du joueur ne les donne pas) : apiname → image.
async function achievementIcons(key: string, appid: number): Promise<Map<string, string>> {
  const res = await fetch(`${API}/ISteamUserStats/GetSchemaForGame/v2/?key=${key}&appid=${appid}&l=french&format=json`, {
    headers: { "User-Agent": UA },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return new Map();
  const data = (await res.json()) as { game?: { availableGameStats?: { achievements?: { name: string; icon: string }[] } } };
  return new Map((data.game?.availableGameStats?.achievements ?? []).map((a) => [a.name, a.icon]));
}

// Fiche du jeu dans la bibliothèque : par appid Steam, sinon par titre.
async function findGame(uid: number, appid: number, name: string): Promise<Media | undefined> {
  const byId = await get<Media>("SELECT * FROM media WHERE user_id = ? AND kind = 'jeu' AND steam_id = ?", [uid, appid]);
  if (byId) return byId;
  const n = normTitle(name);
  const games = await all<Media>("SELECT * FROM media WHERE user_id = ? AND kind = 'jeu' AND steam_id IS NULL", [uid]);
  return games.find((g) => normTitle(g.title) === n);
}

const capsule = (appid: number) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`;

// Première synchro : on mémorise les temps de jeu sans rien publier (sinon « a joué 300 h » pour tout), et on
// reprend les succès des 60 derniers jours. Ensuite : sessions et nouveaux succès.
export async function syncSteam(uid: number, budgetMs = 20000): Promise<{ sessions: number; achievements: number; message?: string }> {
  const user = await getSetting(uid, "steam_user");
  const key = (await getSetting(uid, "steam_key")) || process.env.STEAM_API_KEY || "";
  if (!user) throw new Error("Renseigne ton pseudo Steam dans Réglages.");
  if (!key) throw new Error("Il faut une clé API Steam (steamcommunity.com/dev/apikey) pour lire le temps de jeu et les succès.");
  const id = await steamId(uid, user);
  const games = await ownedGames(key, id);
  const known = new Map((await all<{ appid: number; minutes: number; last_unlock: number }>("SELECT appid, minutes, last_unlock FROM steam_game WHERE user_id = ?", [uid])).map((g) => [g.appid, g]));
  const first = known.size === 0;
  const since = Math.floor(Date.now() / 1000) - 60 * 86400;
  const start = Date.now();
  let sessions = 0;
  let unlocked = 0;
  const stmts: Stmt[] = [];

  for (const g of games) {
    const prev = known.get(g.appid);
    const played = (g.rtime_last_played ?? 0) > (first ? since : 0);
    const delta = prev ? g.playtime_forever - prev.minutes : 0;
    let lastUnlock = prev?.last_unlock ?? (first ? since : 0);
    // Jeu absent de la bibliothèque : l'événement garde le nom et la jaquette Steam, sans créer de fiche.
    const media = delta > 0 || (played && Date.now() - start < budgetMs) ? await findGame(uid, g.appid, g.name) : undefined;

    if (delta > 0) {
      sessions++;
      const at = g.rtime_last_played || Math.floor(Date.now() / 1000);
      await addEvents(uid, [
        { at, type: "playtime", media_id: media?.id ?? null, title: g.name, cover: capsule(g.appid), data: { minutes: delta }, source: "steam", ref: `steam:${g.appid}:${g.playtime_forever}` },
      ]);
    }
    // Succès : seulement pour les jeux joués depuis la dernière fois (ou récemment, à la première synchro).
    if ((delta > 0 || (first && played)) && Date.now() - start < budgetMs) {
      const list = (await achievements(key, id, g.appid)).filter((a) => a.unlocktime > lastUnlock);
      const icons = list.length ? await achievementIcons(key, g.appid).catch(() => new Map<string, string>()) : new Map<string, string>();
      // Un événement par jour de déblocage.
      const byDay = new Map<string, typeof list>();
      for (const a of list) {
        const day = new Date(a.unlocktime * 1000).toISOString().slice(0, 10);
        byDay.set(day, [...(byDay.get(day) ?? []), a]);
      }
      for (const [day, items] of byDay) {
        unlocked += items.length;
        await addEvents(uid, [
          {
            at: Math.max(...items.map((a) => a.unlocktime)),
            type: "achievements",
            media_id: media?.id ?? null,
            title: g.name,
            cover: capsule(g.appid),
            data: {
              count: items.length,
              names: items.map((a) => a.name || a.apiname),
              items: items.map((a) => ({ name: a.name || a.apiname, icon: icons.get(a.apiname) ?? "" })),
            },
            source: "steam",
            ref: `steam-ach:${g.appid}:${day}`,
          },
        ]);
      }
      if (list.length) lastUnlock = Math.max(lastUnlock, ...list.map((a) => a.unlocktime));
    }
    stmts.push({
      sql: `INSERT INTO steam_game (user_id, appid, name, minutes, last_played, last_unlock) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id, appid) DO UPDATE SET name = excluded.name, minutes = excluded.minutes, last_played = excluded.last_played, last_unlock = excluded.last_unlock`,
      args: [uid, g.appid, g.name, g.playtime_forever, g.rtime_last_played ?? 0, lastUnlock],
    });
  }
  await batch(stmts);
  await setSetting(uid, "steam_synced_at", new Date().toISOString());
  return {
    sessions,
    achievements: unlocked,
    message: first ? `${games.length} jeux Steam mémorisés ; les prochaines sessions apparaîtront dans le fil.` : undefined,
  };
}
