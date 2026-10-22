import "server-only";
import { all, run, type Media } from "@/lib/db";
import { FORMAT_LABEL, KINDS, KIND_LABEL, STATUS_LABEL, normTitle, splitList, type Kind, type Status } from "@/lib/kinds";
import { GENRE_FR, igdbToken } from "@/lib/info";

// Statistiques façon AniList, par type : vue d'ensemble (totaux, temps, notes, distributions) et regroupements
// par genre, tag, doubleur, studio, staff, et par lieu et époque de l'action.

export type Facet = "genres" | "tags" | "doubleurs" | "studios" | "staff" | "pays" | "lieux" | "epoques";
export const FACET_LABEL: Record<Facet, string> = {
  genres: "Genres", tags: "Tags", doubleurs: "Doubleurs", studios: "Studios", staff: "Staff", pays: "Pays", lieux: "Lieux", epoques: "Époques",
};
// « Tout » : tous les types ensemble.
export type StatKind = Kind | "tout";

// Regroupements disponibles par type (genres, tags, studios… viennent d'AniList).
export const FACETS_OF: Record<StatKind, Facet[]> = {
  tout: ["genres", "tags", "doubleurs", "studios", "staff", "pays", "lieux", "epoques"],
  anime: ["genres", "tags", "doubleurs", "studios", "staff", "pays", "lieux", "epoques"],
  manga: ["genres", "tags", "staff", "pays", "lieux", "epoques"],
  ln: ["genres", "tags", "staff", "pays", "lieux", "epoques"],
  jeu: ["studios", "pays", "lieux", "epoques"],
  film: ["pays", "lieux", "epoques"],
  serie: ["pays", "lieux", "epoques"],
  roman: ["pays", "lieux", "epoques"],
};
// Ce que mesure le « temps » : minutes, ou à défaut des unités (chapitres, pages).
// « Tout » n'additionne que les minutes (chapitres et pages ne s'ajoutent pas à des heures).
export const MEASURE: Record<StatKind, "minutes" | "chapitres" | "pages"> = {
  tout: "minutes",
  anime: "minutes", serie: "minutes", film: "minutes", jeu: "minutes", manga: "chapitres", ln: "chapitres", roman: "pages",
};

type FacetItem = { key: string; name: string; image?: string };
type Entry = {
  kind: Kind;
  m: Pick<Media, "id" | "title" | "cover" | "cover_grid" | "rating" | "status" | "format" | "progress" | "total">;
  amount: number; // minutes, chapitres ou pages
  planned: number; // minutes encore à voir (prévu, en cours)
  episodes: number | null;
  origin: string | null;
  facets: Partial<Record<Facet, FacetItem[]>>;
};

// ---------------------------------------------------------------------------------------------
// AniList, par lots (genres, tags, studios, staff, doubleurs, durée, pays d'origine), en cache 30 jours.

type AlStat = {
  id: number;
  format: string | null;
  episodes: number | null;
  duration: number | null;
  chapters: number | null;
  countryOfOrigin: string | null;
  genres: string[];
  tags: { name: string; rank: number; isMediaSpoiler: boolean }[];
  studios: { nodes: { id: number; name: string }[] };
  staff: { edges: { role: string; node: { id: number; name: { full: string }; image: { medium: string } } }[] };
  characters: { edges: { voiceActors: { id: number; name: { full: string }; image: { medium: string } }[] | null }[] };
};

const AL_STATS = `query ($ids: [Int]) { Page(perPage: 25) { media(id_in: $ids) {
  id format episodes duration chapters countryOfOrigin genres tags { name rank isMediaSpoiler }
  studios(isMain: true) { nodes { id name } }
  staff(perPage: 6, sort: [RELEVANCE, ID]) { edges { role node { id name { full } image { medium } } } }
} } }`;

// Renvoie ce qui est en cache et complète au plus `budget` lots (limite de débit d'AniList) ; `missing` = ce qui
// manque encore (un rechargement continue).
async function alStats(ids: number[], budget = 8): Promise<{ data: Map<number, AlStat>; missing: number }> {
  const data = new Map<number, AlStat>();
  const fresh = Date.now() / 1000 - 30 * 86400;
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const rows = await all<{ key: string; data: string; fetched_at: number }>(
      `SELECT key, data, fetched_at FROM info_cache WHERE key IN (${chunk.map(() => "?").join(",")})`,
      chunk.map((id) => `alstats:${id}`),
    );
    for (const r of rows) if (r.fetched_at > fresh && r.data !== "null") data.set(Number(r.key.slice(8)), JSON.parse(r.data));
  }
  const todo = ids.filter((id) => !data.has(id));
  for (let b = 0; b < todo.length && b / 25 < budget; b += 25) {
    const batch = todo.slice(b, b + 25);
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: AL_STATS, variables: { ids: batch } }),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    }).catch(() => null);
    if (!res?.ok) break; // limite atteinte : la suite au prochain chargement
    const media = ((await res.json()) as { data?: { Page: { media: AlStat[] } } }).data?.Page.media ?? [];
    const now = Math.floor(Date.now() / 1000);
    for (const m of media) {
      data.set(m.id, m);
      await run("INSERT OR REPLACE INTO info_cache (key, data, fetched_at) VALUES (?, ?, ?)", [`alstats:${m.id}`, JSON.stringify(m), now]);
    }
  }
  return { data, missing: ids.filter((id) => !data.has(id)).length };
}

// Doubleurs : AniList ne les donne pas dans les requêtes groupées, seulement fiche par fiche. On reprend ceux des
// fiches déjà ouvertes (cache « anilist: »), puis on en demande quelques-unes à chaque chargement de l'onglet.
type Voices = { id: number; name: string; image: string }[];

async function alVoices(ids: number[], budget = 15): Promise<{ data: Map<number, Voices>; missing: number }> {
  const data = new Map<number, Voices>();
  const keys = ids.flatMap((id) => [`alva:${id}`, `anilist:${id}`]);
  for (let i = 0; i < keys.length; i += 400) {
    const chunk = keys.slice(i, i + 400);
    for (const r of await all<{ key: string; data: string }>(`SELECT key, data FROM info_cache WHERE key IN (${chunk.map(() => "?").join(",")})`, chunk)) {
      const id = Number(r.key.split(":")[1]);
      if (data.has(id) && r.key.startsWith("anilist:")) continue;
      const d = JSON.parse(r.data) as { characters?: { edges: { voiceActors: { id?: number; name: { full: string }; image: { large?: string; medium?: string } }[] | null }[] } } | Voices | null;
      if (Array.isArray(d)) data.set(id, d);
      else if (d?.characters) {
        const v = new Map<string, Voices[number]>();
        for (const e of d.characters.edges) for (const a of e.voiceActors ?? []) v.set(a.name.full, { id: a.id ?? 0, name: a.name.full, image: a.image.medium ?? a.image.large ?? "" });
        data.set(id, [...v.values()].slice(0, 6));
      }
    }
  }
  const todo = ids.filter((id) => !data.has(id));
  for (const id of todo.slice(0, budget)) {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query:
          "query ($id: Int) { Media(id: $id) { characters(perPage: 6, sort: [ROLE, RELEVANCE, ID]) { edges { voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) { id name { full } image { medium } } } } } }",
        variables: { id },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    if (!res?.ok) break;
    const edges = ((await res.json()) as { data?: { Media: { characters: { edges: { voiceActors: { id: number; name: { full: string }; image: { medium: string } }[] | null }[] } } | null } }).data?.Media?.characters.edges ?? [];
    const v = new Map<number, Voices[number]>();
    for (const e of edges) for (const a of e.voiceActors ?? []) v.set(a.id, { id: a.id, name: a.name.full, image: a.image.medium });
    data.set(id, [...v.values()]);
    await run("INSERT OR REPLACE INTO info_cache (key, data, fetched_at) VALUES (?, ?, ?)", [`alva:${id}`, JSON.stringify([...v.values()]), Math.floor(Date.now() / 1000)]);
  }
  return { data, missing: ids.filter((id) => !data.has(id)).length };
}

// Studios des jeux (développeurs) : VNDB ou Steam si la fiche a déjà été ouverte, sinon IGDB (par l'id Steam ou
// le titre), mis en cache 60 jours ; `budget` requêtes IGDB au plus par appel.
// Noms de pays en français d'après le code ISO (« JP » → « Japon »).
const REGION = new Intl.DisplayNames(["fr"], { type: "region" });
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return REGION.of(code.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}
// IGDB donne le pays des sociétés en code numérique ISO 3166 : les plus courants.
const ISO_NUM: Record<number, string> = {
  392: "JP", 840: "US", 826: "GB", 250: "FR", 124: "CA", 276: "DE", 410: "KR", 156: "CN", 158: "TW", 752: "SE", 616: "PL", 380: "IT",
  724: "ES", 36: "AU", 643: "RU", 804: "UA", 203: "CZ", 246: "FI", 528: "NL", 56: "BE", 208: "DK", 578: "NO", 76: "BR", 344: "HK",
  702: "SG", 554: "NZ", 40: "AT", 756: "CH", 372: "IE", 484: "MX", 32: "AR", 348: "HU", 642: "RO", 792: "TR", 376: "IL", 356: "IN",
  620: "PT", 300: "GR", 152: "CL", 703: "SK", 705: "SI", 191: "HR", 688: "RS", 100: "BG", 112: "BY", 233: "EE", 428: "LV", 440: "LT",
  458: "MY", 764: "TH", 360: "ID", 608: "PH", 704: "VN", 710: "ZA", 818: "EG", 784: "AE", 682: "SA",
};

// Jeux : développeurs (VNDB ou Steam si la fiche a déjà été ouverte, sinon IGDB) et pays du développeur (IGDB),
// mis en cache ; `budget` requêtes IGDB au plus par appel.
const gameKey = (m: Pick<Media, "steam_id" | "title">) => (m.steam_id ? `gdev2:steam:${m.steam_id}` : `gdev2:${normTitle(m.title)}`);
type GameInfo = { devs: string[]; country: string | null };

async function gameInfo(rows: Media[], budget = 0): Promise<{ data: Map<number, GameInfo>; missing: number }> {
  const data = new Map<number, GameInfo>();
  const keys = [...new Set(rows.flatMap((m) => [gameKey(m), m.vndb_id && m.vndb_id !== "-" ? `vndb:${m.vndb_id}` : "", m.steam_id ? `steam:${m.steam_id}` : ""]).filter(Boolean))];
  const found = new Map<string, unknown>();
  for (let i = 0; i < keys.length; i += 400) {
    const chunk = keys.slice(i, i + 400);
    for (const r of await all<{ key: string; data: string }>(`SELECT key, data FROM info_cache WHERE key IN (${chunk.map(() => "?").join(",")})`, chunk)) {
      found.set(r.key, JSON.parse(r.data));
    }
  }
  for (const m of rows) {
    const own = found.get(gameKey(m)) as GameInfo | undefined;
    if (!own) continue;
    // VNDB connaît mieux les développeurs d'un visual novel ; IGDB donne le pays.
    const vn = m.vndb_id && m.vndb_id !== "-" ? (found.get(`vndb:${m.vndb_id}`) as { vn?: { developers: { name: string }[] } } | undefined) : undefined;
    const steam = m.steam_id ? (found.get(`steam:${m.steam_id}`) as { developers?: string[] } | undefined) : undefined;
    const devs = vn?.vn?.developers.length ? vn.vn.developers.map((x) => x.name) : own.devs.length ? own.devs : (steam?.developers ?? []);
    data.set(m.id, { devs, country: own.country });
  }
  const todo = rows.filter((m) => !data.has(m.id));
  const token = budget && todo.length && process.env.TWITCH_CLIENT_ID ? await igdbToken().catch(() => null) : null;
  type IgdbHit = { name: string; involved_companies?: { developer: boolean; company: { name: string; country?: number } }[] };
  for (const m of token ? todo.slice(0, budget) : []) {
    const fields = "fields name, involved_companies.developer, involved_companies.company.name, involved_companies.company.country;";
    const query = (body: string) =>
      fetch("https://api.igdb.com/v4/games", {
        method: "POST",
        headers: { "Client-ID": process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token}` },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }).then((r) => (r.ok ? (r.json() as Promise<IgdbHit[]>) : null));
    let games = m.steam_id ? await query(`${fields} where external_games.uid = "${m.steam_id}" & external_games.external_game_source = 1; limit 1;`).catch(() => null) : [];
    if (games === null) break; // limite de débit : la suite plus tard
    if (!games.length) games = (await query(`search "${m.title.replace(/"/g, "")}"; ${fields} limit 5;`).catch(() => null)) ?? [];
    const g = games.find((x) => normTitle(x.name) === normTitle(m.title)) ?? games[0];
    const devCompanies = (g?.involved_companies ?? []).filter((c) => c.developer);
    const info: GameInfo = {
      devs: [...new Set(devCompanies.map((c) => c.company.name))],
      country: devCompanies.map((c) => ISO_NUM[c.company.country ?? 0]).find(Boolean) ?? null,
    };
    data.set(m.id, info);
    await run("INSERT OR REPLACE INTO info_cache (key, data, fetched_at) VALUES (?, ?, ?)", [gameKey(m), JSON.stringify(info), Math.floor(Date.now() / 1000)]);
    await new Promise((r) => setTimeout(r, 260)); // IGDB : 4 requêtes par seconde
  }
  return { data, missing: rows.filter((m) => !data.has(m.id)).length };
}

// Films (TMDB) et séries (TVmaze) : durée et pays d'origine. La fiche complète (ouverte une fois) suffit ; sinon une
// requête légère, mise en cache.
type ScreenInfo = { runtime: number | null; country: string | null };

async function screenInfo(rows: Media[], kind: "film" | "serie", budget = 0): Promise<{ data: Map<number, ScreenInfo>; missing: number }> {
  const data = new Map<number, ScreenInfo>();
  const idOf = (m: Media) => (kind === "film" ? m.tmdb_id : m.tvmaze_id);
  const full = (m: Media) => (kind === "film" ? `tmdb:${m.tmdb_id}` : `tvmaze:${m.tvmaze_id}`);
  const light = (m: Media) => (kind === "film" ? `tmdbo:${m.tmdb_id}` : `tvo:${m.tvmaze_id}`);
  const usable = rows.filter((m) => idOf(m));
  const keys = usable.flatMap((m) => [full(m), light(m)]);
  const found = new Map<string, unknown>();
  for (let i = 0; i < keys.length; i += 400) {
    const chunk = keys.slice(i, i + 400);
    for (const r of await all<{ key: string; data: string }>(`SELECT key, data FROM info_cache WHERE key IN (${chunk.map(() => "?").join(",")})`, chunk)) {
      found.set(r.key, JSON.parse(r.data));
    }
  }
  type Show = {
    runtime?: number | null;
    averageRuntime?: number | null;
    origin_country?: string[];
    production_countries?: { iso_3166_1: string }[];
    network?: { country?: { code: string } | null } | null;
    webChannel?: { country?: { code: string } | null } | null;
  };
  const parse = (d: Show): ScreenInfo => ({
    runtime: d.runtime ?? d.averageRuntime ?? null,
    country: d.origin_country?.[0] ?? d.production_countries?.[0]?.iso_3166_1 ?? d.network?.country?.code ?? d.webChannel?.country?.code ?? null,
  });
  for (const m of usable) {
    const l = found.get(light(m)) as ScreenInfo | undefined;
    const f = found.get(full(m)) as Show | null | undefined;
    if (l) data.set(m.id, l);
    else if (f) data.set(m.id, parse(f));
  }
  const tmdb = process.env.TMDB_TOKEN;
  for (const m of usable.filter((x) => !data.has(x.id)).slice(0, budget)) {
    let url: string;
    let headers: Record<string, string> = {};
    if (kind === "film") {
      if (!tmdb) break;
      const v3 = /^[0-9a-f]{32}$/i.test(tmdb);
      url = `https://api.themoviedb.org/3/movie/${m.tmdb_id}${v3 ? `?api_key=${tmdb}` : ""}`;
      if (!v3) headers = { Authorization: `Bearer ${tmdb}` };
    } else url = `https://api.tvmaze.com/shows/${m.tvmaze_id}`;
    const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (!res?.ok) break;
    const info = parse((await res.json()) as Show);
    data.set(m.id, info);
    await run("INSERT OR REPLACE INTO info_cache (key, data, fetched_at) VALUES (?, ?, ?)", [light(m), JSON.stringify(info), Math.floor(Date.now() / 1000)]);
  }
  return { data, missing: usable.filter((m) => !data.has(m.id)).length };
}

// ---------------------------------------------------------------------------------------------

const list = (key: string, s: string): FacetItem[] => splitList(s).map((x) => ({ key: `${key}:${x.toLowerCase()}`, name: x }));

// voices : récupérer aussi les doubleurs (onglet Doubleurs seulement, c'est une requête par œuvre).
export async function loadEntries(uid: number, kind: StatKind, viewer: number, voices = false): Promise<{ entries: Entry[]; missing: number; missingVoices: number }> {
  if (kind === "tout") {
    const parts = await Promise.all(KINDS.map((k) => loadKind(uid, k, viewer, voices)));
    return {
      // Seules les minutes s'additionnent : chapitres et pages comptent pour 0 dans le temps passé.
      entries: parts.flatMap((p) => p.entries.map((e) => (MEASURE[e.kind] === "minutes" ? e : { ...e, amount: 0 }))),
      missing: parts.reduce((s, p) => s + p.missing, 0),
      missingVoices: parts.reduce((s, p) => s + p.missingVoices, 0),
    };
  }
  return loadKind(uid, kind, viewer, voices);
}

async function loadKind(uid: number, kind: Kind, viewer: number, voices: boolean): Promise<{ entries: Entry[]; missing: number; missingVoices: number }> {
  const rows = await all<Media>(`SELECT * FROM media WHERE user_id = ? AND kind = ?${uid === viewer ? "" : " AND private = 0"}`, [uid, kind]);
  const alIds = rows.map((m) => m.anilist_id).filter((x): x is number => Boolean(x));
  const al = kind === "anime" || kind === "manga" || kind === "ln" ? await alStats(alIds) : null;
  const va = voices && kind === "anime" ? await alVoices(alIds) : null;

  // Temps de jeu : sessions (journal Backloggd, appli) et heures Steam.
  const play = new Map<number, number>();
  const devs = kind === "jeu" ? await gameInfo(rows) : null;
  const screen = kind === "film" || kind === "serie" ? await screenInfo(rows, kind) : null;
  if (kind === "jeu") {
    for (const r of await all<{ media_id: number; minutes: number }>(
      "SELECT a.media_id, SUM(a.minutes) AS minutes FROM activity a JOIN media m ON m.id = a.media_id WHERE m.user_id = ? GROUP BY a.media_id",
      [uid],
    )) play.set(r.media_id, r.minutes);
    for (const r of await all<{ id: number; minutes: number }>(
      "SELECT m.id, s.minutes FROM media m JOIN steam_game s ON s.user_id = m.user_id AND s.appid = m.steam_id WHERE m.user_id = ?",
      [uid],
    )) play.set(r.id, Math.max(play.get(r.id) ?? 0, r.minutes));
  }
  const entries = rows.map((m): Entry => {
    const a = m.anilist_id ? al?.data.get(m.anilist_id) : undefined;
    const done = m.status === "termine";
    let amount = 0;
    let planned = 0;
    if (kind === "anime") {
      const eps = done ? (a?.episodes ?? m.total ?? m.progress) : m.progress;
      const dur = a?.duration ?? 24;
      amount = eps * dur;
      if (m.status === "prevu" || m.status === "en_cours") planned = Math.max(0, (a?.episodes ?? m.total ?? 0) - m.progress) * dur;
    } else if (kind === "manga" || kind === "ln" || kind === "roman") {
      amount = done ? (a?.chapters ?? m.total ?? m.progress) : m.progress;
    } else if (kind === "jeu") {
      amount = play.get(m.id) ?? 0;
    } else if (kind === "film") {
      amount = done ? (screen?.data.get(m.id)?.runtime ?? 0) : 0;
    } else if (kind === "serie") {
      amount = (done ? (m.total ?? m.progress) : m.progress) * (screen?.data.get(m.id)?.runtime ?? 0);
    }
    const facets: Entry["facets"] = {
      pays: list("pays", m.setting_country),
      lieux: list("lieu", m.setting_place),
      epoques: list("epoque", m.setting_era),
    };
    // Clé sans espaces ni ponctuation : « Alice Soft » (VNDB) et « Alicesoft » (IGDB) ne font qu'un studio.
    if (devs) facets.studios = (devs.data.get(m.id)?.devs ?? []).map((d) => ({ key: `s:${normTitle(d)}`, name: d }));
    if (a) {
      facets.genres = a.genres.map((g) => ({ key: `g:${g}`, name: GENRE_FR[g] ?? g }));
      facets.tags = a.tags.filter((t) => !t.isMediaSpoiler && t.rank >= 50).map((t) => ({ key: `t:${t.name}`, name: t.name }));
      facets.studios = a.studios.nodes.map((s) => ({ key: `s:${normTitle(s.name)}`, name: s.name }));
      facets.staff = a.staff.edges.map((e) => ({ key: `p:${e.node.id}`, name: e.node.name.full, image: e.node.image.medium }));
      facets.doubleurs = (va?.data.get(a.id) ?? []).map((v) => ({ key: `v:${v.name}`, name: v.name, image: v.image }));
    }
    return {
      kind,
      m: { id: m.id, title: m.title, cover: m.cover, cover_grid: m.cover_grid, rating: m.rating, status: m.status, format: a?.format ?? m.format, progress: m.progress, total: m.total },
      amount,
      planned,
      episodes: a?.episodes ?? m.total,
      // Pays d'origine : AniList, sinon le pays du développeur (jeux), de la production (films) ou de la chaîne (séries).
      origin: countryName(a?.countryOfOrigin ?? devs?.data.get(m.id)?.country ?? screen?.data.get(m.id)?.country),
      facets,
    };
  });
  return { entries, missing: (al?.missing ?? 0) + (devs?.missing ?? 0) + (screen?.missing ?? 0), missingVoices: va?.missing ?? 0 };
}

// ---------------------------------------------------------------------------------------------

export type Group = {
  key: string;
  name: string;
  image?: string;
  count: number;
  mean: number | null; // note moyenne sur 10
  amount: number;
  covers: { id: number; title: string; cover: string }[];
};

export function groupBy(entries: Entry[], facet: Facet, sort: "count" | "note" | "temps"): Group[] {
  const groups = new Map<string, { item: FacetItem; list: Entry[] }>();
  for (const e of entries) {
    for (const item of e.facets[facet] ?? []) {
      const g = groups.get(item.key) ?? { item, list: [] };
      g.list.push(e);
      groups.set(item.key, g);
    }
  }
  const out = [...groups.values()].map(({ item, list: l }) => {
    const rated = l.filter((e) => e.m.rating != null);
    return {
      key: item.key,
      name: item.name,
      image: item.image,
      count: l.length,
      mean: rated.length ? rated.reduce((s, e) => s + e.m.rating!, 0) / rated.length : null,
      amount: l.reduce((s, e) => s + e.amount, 0),
      covers: [...l]
        .sort((a, b) => (b.m.rating ?? -1) - (a.m.rating ?? -1))
        .slice(0, 6)
        .map((e) => ({ id: e.m.id, title: e.m.title, cover: e.m.cover_grid || e.m.cover })),
    };
  });
  const by = {
    count: (a: Group, b: Group) => b.count - a.count || (b.mean ?? 0) - (a.mean ?? 0),
    note: (a: Group, b: Group) => (b.mean ?? -1) - (a.mean ?? -1) || b.count - a.count,
    temps: (a: Group, b: Group) => b.amount - a.amount || b.count - a.count,
  }[sort];
  // Une note moyenne sur un ou deux titres n'a pas de sens : au moins 3 pour le tri par note.
  return (sort === "note" ? out.filter((g) => g.count >= 3) : out).sort(by);
}

export type Overview = {
  total: number;
  amount: number;
  planned: number;
  mean: number | null;
  deviation: number | null;
  scores: { label: string; count: number }[];
  episodes: { label: string; count: number }[];
  formats: { label: string; count: number }[];
  kinds: { label: string; count: number }[];
  statuses: { label: string; count: number }[];
  origins: { label: string; count: number }[];
};

const tally = (values: (string | null)[]) => {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
};

export function overview(entries: Entry[]): Overview {
  const ratings = entries.map((e) => e.m.rating).filter((r): r is number => r != null);
  const mean = ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : null;
  const deviation = mean != null && ratings.length > 1 ? Math.sqrt(ratings.reduce((s, r) => s + (r - mean) ** 2, 0) / ratings.length) : null;
  // Notes en étoiles (sur 5), arrondies à l'étoile supérieure ; une note de 0 compte dans la première.
  const scores = [1, 2, 3, 4, 5].map((s) => ({ label: `${s}`, count: ratings.filter((r) => Math.max(1, Math.ceil(r / 2)) === s).length }));
  const BUCKETS: [string, number, number][] = [["1", 1, 1], ["2-6", 2, 6], ["7-16", 7, 16], ["17-28", 17, 28], ["29-55", 29, 55], ["56-100", 56, 100], ["101+", 101, 1e9]];
  const episodes = [
    ...BUCKETS.map(([label, lo, hi]) => ({ label, count: entries.filter((e) => e.episodes != null && e.episodes >= lo && e.episodes <= hi).length })),
    { label: "Inconnu", count: entries.filter((e) => e.episodes == null).length },
  ];
  return {
    total: entries.length,
    amount: entries.reduce((s, e) => s + e.amount, 0),
    planned: entries.reduce((s, e) => s + e.planned, 0),
    mean,
    deviation,
    scores,
    episodes,
    formats: tally(entries.map((e) => (e.m.format ? (FORMAT_LABEL[e.m.format] ?? e.m.format) : null))),
    kinds: tally(entries.map((e) => KIND_LABEL[e.kind])),
    statuses: tally(entries.map((e) => STATUS_LABEL[e.m.status as Status])),
    origins: tally(entries.map((e) => e.origin)),
  };
}

// Remplit le cache des stats (AniList, doubleurs, studios et pays des jeux, durées et pays des films et séries) tant
// que les limites de débit le permettent. Après l'affichage (next/server `after`), par petits lots ; avec `force`
// (bouton « Mettre à jour »), par gros lots.
export async function warmStats(uid: number, kind: StatKind, force = false) {
  if (kind === "tout") {
    for (const k of ["anime", "manga", "ln", "jeu", "film", "serie"] as const) await warmStats(uid, k, force);
    return;
  }
  const rows = await all<Media>("SELECT * FROM media WHERE user_id = ? AND kind = ?", [uid, kind]);
  if (kind === "jeu") {
    await gameInfo(rows, force ? 150 : 60);
    return;
  }
  if (kind === "film" || kind === "serie") {
    await screenInfo(rows, kind, force ? 200 : 60);
    return;
  }
  if (kind !== "anime" && kind !== "manga" && kind !== "ln") return;
  const ids = rows.map((m) => m.anilist_id).filter((x): x is number => Boolean(x));
  const stats = await alStats(ids, force ? 40 : 20);
  if (kind === "anime" && !stats.missing) await alVoices(ids, force ? 100 : 60);
}
