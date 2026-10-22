import "server-only";
import { get, run, type Media } from "@/lib/db";
import { FORMAT_LABEL, normTitle } from "@/lib/kinds";
import { vndbMatch } from "@/lib/sync";

// Fiche détaillée d'une œuvre pour la page média, façon AniList : bannière, description, infos de la colonne
// (format, dates, studios, développeurs et éditeurs par langue, fan-trads…), titres et alias, tags, relations,
// personnages, openings. Chaque source est mise en cache (table info_cache, commune à tous les comptes).

export type Person = { name: string; image: string; role: string; va?: { name: string; image: string } };
export type Relation = { label: string; title: string; cover: string; sub: string; anilistId: number; type: "ANIME" | "MANGA" };
export type Company = { role: string; name: string; lang?: string; fan?: boolean; url?: string };
export type Theme = { label: string; type: string; title: string; artists: string; episodes: string; video: string; spoiler: boolean };

export type Info = {
  banner: string | null;
  description: string;
  facts: { label: string; value: string }[];
  titles: { label: string; value: string }[];
  synonyms: string[];
  genres: string[];
  tags: { name: string; rank: number; spoiler: boolean }[];
  companies: Company[];
  relations: Relation[];
  characters: Person[];
  themes: Theme[];
  sources: string[];
  story: string; // histoire (IGDB), en plus de la description
  keywords: string[];
  releases: { platform: string; date: string }[];
  timeToBeat: { hastily: number; normally: number; completely: number; count: number } | null; // en heures
  links: [string, string][]; // fiches externes trouvées par les sources (IGDB…)
  gameSeries: { name: string; games: SeriesGame[] }[]; // autres jeux de la même série (IGDB)
  gameRelations: SeriesGame[]; // préquelle et suite directes d'un jeu (Wikidata), avec leur fiche IGDB
  charactersFrom: string; // personnages repris d'une adaptation AniList (jeux)
};

// relation : « Original » (le jeu dont celui-ci est une version), « Remake », « Remaster », « Version étendue »… ou « Même série ».
export type SeriesGame = { name: string; year: number | null; cover: string; url: string; type: string; relation: string };

export function emptyInfo(): Info {
  return {
    banner: null, description: "", facts: [], titles: [], synonyms: [], genres: [], tags: [], companies: [], relations: [], characters: [],
    themes: [], sources: [], story: "", keywords: [], releases: [], timeToBeat: null, links: [], gameSeries: [], gameRelations: [], charactersFrom: "",
  };
}

const UA = "Almanach/0.1 (personal media tracker)";
const DAY = 86400;

// Lit le cache, sinon interroge la source et garde la réponse (même « rien trouvé », pour ne pas redemander).
// Une source injoignable rend l'ancienne réponse s'il y en a une.
async function cached<T>(key: string, ttlDays: number, fetcher: () => Promise<T | null>): Promise<T | null> {
  const row = await get<{ data: string; fetched_at: number }>("SELECT data, fetched_at FROM info_cache WHERE key = ?", [key]);
  if (row && Date.now() / 1000 - row.fetched_at < ttlDays * DAY) return JSON.parse(row.data) as T | null;
  try {
    const value = await fetcher();
    await run("INSERT OR REPLACE INTO info_cache (key, data, fetched_at) VALUES (?, ?, ?)", [key, JSON.stringify(value), Math.floor(Date.now() / 1000)]);
    return value;
  } catch {
    return row ? (JSON.parse(row.data) as T | null) : null;
  }
}

async function json<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init.headers ?? {}) }, cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`${new URL(url).host} : HTTP ${res.status}`);
  return (await res.json()) as T;
}

function stripHtml(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, "\"")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
function frDate(d: { year: number | null; month: number | null; day: number | null } | null | undefined): string {
  if (!d?.year) return "";
  return [d.day, d.month ? MONTHS_SHORT[d.month - 1] : null, d.year].filter(Boolean).join(" ");
}
function isoToFr(s: string | null | undefined): string {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(s ?? "");
  return m ? frDate({ year: Number(m[1]), month: m[2] ? Number(m[2]) : null, day: m[3] ? Number(m[3]) : null }) : (s ?? "");
}

export const GENRE_FR: Record<string, string> = {
  Action: "Action", Adventure: "Aventure", Comedy: "Comédie", Drama: "Drame", Ecchi: "Ecchi", Fantasy: "Fantasy", Horror: "Horreur",
  "Mahou Shoujo": "Magical girl", Mecha: "Mecha", Music: "Musique", Mystery: "Mystère", Psychological: "Psychologique",
  Romance: "Romance", "Sci-Fi": "Science-fiction", "Slice of Life": "Tranche de vie", Sports: "Sport", Supernatural: "Surnaturel",
  Thriller: "Thriller", Hentai: "Hentai",
};
const STATUS_FR: Record<string, string> = {
  FINISHED: "Terminé", RELEASING: "En cours", NOT_YET_RELEASED: "À venir", CANCELLED: "Annulé", HIATUS: "En pause",
};
const SEASON_FR: Record<string, string> = { WINTER: "Hiver", SPRING: "Printemps", SUMMER: "Été", FALL: "Automne" };
const SOURCE_FR: Record<string, string> = {
  ORIGINAL: "Original", MANGA: "Manga", LIGHT_NOVEL: "Light novel", VISUAL_NOVEL: "Visual novel", VIDEO_GAME: "Jeu vidéo",
  NOVEL: "Roman", WEB_NOVEL: "Web novel", DOUJINSHI: "Doujinshi", ANIME: "Anime", OTHER: "Autre", WEB_MANGA: "Webtoon",
  LIVE_ACTION: "Prise de vues réelles", GAME: "Jeu", COMIC: "Comic", MULTIMEDIA_PROJECT: "Projet multimédia", PICTURE_BOOK: "Livre illustré",
};

// Relations AniList, en français ; les à-côtés (spécial, OAV, film, clip) sont nommés par leur format.
const RELATION_FR: Record<string, string> = {
  ADAPTATION: "Adaptation", SOURCE: "Source", PREQUEL: "Préquelle", SEQUEL: "Suite", PARENT: "Œuvre principale",
  SIDE_STORY: "Histoire parallèle", SPIN_OFF: "Spin-off", ALTERNATIVE: "Version alternative", SUMMARY: "Résumé",
  COMPILATION: "Compilation", CONTAINS: "Contient", OTHER: "Autre",
};
const SIDE_FORMAT: Record<string, string> = { SPECIAL: "Spécial", OVA: "OAV", MOVIE: "Film", MUSIC: "Clip" };
export function relationLabel(type: string, format: string | null): string {
  if (format && SIDE_FORMAT[format] && !["SOURCE", "ADAPTATION", "PREQUEL", "SEQUEL"].includes(type)) return SIDE_FORMAT[format];
  return RELATION_FR[type] ?? "Autre";
}

// ---------------------------------------------------------------------------------------------
// AniList

type AlMedia = {
  type: "ANIME" | "MANGA";
  bannerImage: string | null;
  description: string | null;
  format: string | null;
  status: string | null;
  episodes: number | null;
  duration: number | null;
  chapters: number | null;
  volumes: number | null;
  season: string | null;
  seasonYear: number | null;
  startDate: { year: number | null; month: number | null; day: number | null };
  endDate: { year: number | null; month: number | null; day: number | null };
  source: string | null;
  averageScore: number | null;
  genres: string[];
  synonyms: string[];
  title: { romaji: string | null; english: string | null; native: string | null };
  tags: { name: string; rank: number; isMediaSpoiler: boolean }[];
  studios: { edges: { isMain: boolean; node: { name: string; isAnimationStudio: boolean } }[] };
  staff: { edges: { role: string; node: { name: { full: string } } }[] };
  relations: { edges: { relationType: string; node: { id: number; type: "ANIME" | "MANGA"; format: string | null; status: string | null; title: { userPreferred: string }; coverImage: { large: string } } }[] };
  characters: { edges: { role: string; node: { name: { full: string }; image: { large: string } }; voiceActors: { name: { full: string }; image: { large: string } }[] }[] };
};

const AL_QUERY = `query ($id: Int) { Media(id: $id) {
  type bannerImage description(asHtml: false) format status episodes duration chapters volumes season seasonYear
  startDate { year month day } endDate { year month day } source(version: 3) averageScore genres synonyms
  title { romaji english native } tags { name rank isMediaSpoiler }
  studios { edges { isMain node { name isAnimationStudio } } }
  staff(sort: [RELEVANCE, ID], perPage: 8) { edges { role node { name { full } } } }
  relations { edges { relationType(version: 2) node { id type format status title { userPreferred } coverImage { large } } } }
  characters(sort: [ROLE, RELEVANCE, ID], perPage: 12) { edges { role node { name { full } image { large } }
    voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) { name { full } image { large } } } }
} }`;

async function anilist(id: number): Promise<AlMedia | null> {
  return cached(`anilist:${id}`, 14, async () => {
    const r = await json<{ data: { Media: AlMedia | null } }>("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: AL_QUERY, variables: { id } }),
    });
    return r.data.Media;
  });
}

const CHAR_ROLE: Record<string, string> = { MAIN: "Principal", SUPPORTING: "Secondaire", BACKGROUND: "Figurant" };

function fromAnilist(info: Info, a: AlMedia) {
  info.sources.push("AniList");
  info.banner ??= a.bannerImage;
  info.description ||= stripHtml(a.description);
  const f = info.facts;
  if (a.format) f.push({ label: "Format", value: FORMAT_LABEL[a.format] ?? a.format });
  if (a.episodes) f.push({ label: "Épisodes", value: String(a.episodes) });
  if (a.duration) f.push({ label: "Durée", value: `${a.duration} min${a.episodes && a.episodes > 1 ? " par épisode" : ""}` });
  if (a.chapters) f.push({ label: "Chapitres", value: String(a.chapters) });
  if (a.volumes) f.push({ label: "Volumes", value: String(a.volumes) });
  if (a.status) f.push({ label: "Statut", value: STATUS_FR[a.status] ?? a.status });
  if (frDate(a.startDate)) f.push({ label: "Début", value: frDate(a.startDate) });
  if (frDate(a.endDate)) f.push({ label: "Fin", value: frDate(a.endDate) });
  if (a.season && a.seasonYear) f.push({ label: "Saison", value: `${SEASON_FR[a.season]} ${a.seasonYear}` });
  if (a.averageScore) f.push({ label: "Note moyenne", value: `${a.averageScore} %` });
  if (a.source) f.push({ label: "Source", value: SOURCE_FR[a.source] ?? a.source });
  info.genres.push(...a.genres.map((g) => GENRE_FR[g] ?? g));
  info.titles.push(
    ...([["Romaji", a.title.romaji], ["Anglais", a.title.english], ["Natif", a.title.native]] as const)
      .filter(([, v]) => v)
      .map(([label, value]) => ({ label, value: value! })),
  );
  info.synonyms.push(...a.synonyms);
  info.tags.push(...a.tags.map((t) => ({ name: t.name, rank: t.rank, spoiler: t.isMediaSpoiler })));
  for (const e of a.studios.edges) info.companies.push({ role: e.node.isAnimationStudio ? "Studio" : "Production", name: e.node.name });
  if (a.type === "MANGA") {
    for (const e of a.staff.edges) {
      const role = /story\s*&\s*art/i.test(e.role) ? "Auteur" : /story|original creator/i.test(e.role) ? "Scénario" : /^art|illustration/i.test(e.role) ? "Dessin" : null;
      if (role) info.companies.push({ role, name: e.node.name.full });
    }
  }
  info.relations.push(
    ...a.relations.edges
      .filter((e) => e.relationType !== "CHARACTER")
      .map((e) => ({
        label: relationLabel(e.relationType, e.node.format),
        title: e.node.title.userPreferred,
        cover: e.node.coverImage.large,
        sub: [FORMAT_LABEL[e.node.format ?? ""] ?? e.node.format, STATUS_FR[e.node.status ?? ""]].filter(Boolean).join(" · "),
        anilistId: e.node.id,
        type: e.node.type,
      })),
  );
  info.characters.push(
    ...a.characters.edges.map((e) => ({
      name: e.node.name.full,
      image: e.node.image.large,
      role: CHAR_ROLE[e.role] ?? e.role,
      va: e.voiceActors[0] ? { name: e.voiceActors[0].name.full, image: e.voiceActors[0].image.large } : undefined,
    })),
  );
}

// ---------------------------------------------------------------------------------------------
// animethemes.moe : openings et endings des anime (vidéos webm), retrouvés par l'id AniList.

type AtTheme = {
  type: string;
  sequence: number | null;
  slug: string;
  song: { title: string | null; artists: { name: string }[] } | null;
  animethemeentries: { episodes: string | null; spoiler: boolean; videos: { link: string; resolution: number | null }[] }[];
};

async function animethemes(anilistId: number): Promise<Theme[] | null> {
  return cached(`animethemes:${anilistId}`, 14, async () => {
    const q = new URLSearchParams({
      "filter[has]": "resources",
      "filter[site]": "AniList",
      "filter[external_id]": String(anilistId),
      include: "animethemes.animethemeentries.videos,animethemes.song.artists",
    });
    const r = await json<{ anime: { animethemes: AtTheme[] }[] }>(`https://api.animethemes.moe/anime?${q}`);
    const themes = r.anime[0]?.animethemes ?? [];
    return themes.map((t) => {
      const entry = t.animethemeentries[0];
      const video = [...(entry?.videos ?? [])].sort((a, b) => (b.resolution ?? 0) - (a.resolution ?? 0))[0];
      return {
        label: t.slug,
        type: t.type,
        title: t.song?.title ?? "",
        artists: t.song?.artists.map((a) => a.name).join(", ") ?? "",
        episodes: entry?.episodes ?? "",
        video: video?.link ?? "",
        spoiler: Boolean(entry?.spoiler),
      };
    });
  });
}

// ---------------------------------------------------------------------------------------------
// VNDB : visual novels (description, titres, éditeurs par langue avec les fan-trads, personnages, captures).

type VnData = {
  title: string;
  alttitle: string | null;
  titles: { title: string; latin: string | null; lang: string; main: boolean; official: boolean }[];
  aliases: string[];
  description: string | null;
  released: string | null;
  length_minutes: number | null;
  rating: number | null;
  developers: { name: string }[];
  screenshots: { url: string; sexual: number; violence: number; dims: [number, number] }[];
  tags: { name: string; rating: number; spoiler: number }[];
  va: { character: { id: string }; staff: { name: string } }[];
};
type VnRelease = { languages: { lang: string; mtl: boolean }[]; official: boolean; producers: { name: string; developer: boolean; publisher: boolean }[] };
type VnChar = { id: string; name: string; image: { url: string; sexual: number } | null; vns: { id: string; role: string }[] };
type Vn = { vn: VnData; releases: VnRelease[]; characters: VnChar[] };

async function vndbPost<T>(path: string, body: object): Promise<T> {
  return json<T>(`https://api.vndb.org/kana/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function vndb(id: string): Promise<Vn | null> {
  return cached(`vndb:${id}`, 14, async () => {
    const [vn, rel, chars] = await Promise.all([
      vndbPost<{ results: VnData[] }>("vn", {
        filters: ["id", "=", id],
        fields:
          "title, alttitle, titles.title, titles.latin, titles.lang, titles.main, titles.official, aliases, description, released, length_minutes, rating, developers.name, screenshots.url, screenshots.sexual, screenshots.violence, screenshots.dims, tags.name, tags.rating, tags.spoiler, va.character.id, va.staff.name",
      }),
      vndbPost<{ results: VnRelease[] }>("release", {
        filters: ["vn", "=", ["id", "=", id]],
        fields: "languages.lang, languages.mtl, official, producers.name, producers.developer, producers.publisher",
        results: 100,
      }),
      vndbPost<{ results: VnChar[] }>("character", {
        filters: ["vn", "=", ["id", "=", id]],
        fields: "name, image.url, image.sexual, vns.id, vns.role",
        results: 40,
      }),
    ]);
    if (!vn.results[0]) return null;
    return { vn: vn.results[0], releases: rel.results, characters: chars.results };
  });
}

// Code de langue VNDB → code pays du drapeau (flagcdn).
const LANG_FLAG: Record<string, string> = {
  ja: "jp", en: "gb", fr: "fr", es: "es", de: "de", it: "it", ru: "ru", "zh-Hans": "cn", "zh-Hant": "tw", zh: "cn", ko: "kr",
  "pt-br": "br", "pt-pt": "pt", pl: "pl", uk: "ua", vi: "vn", th: "th", id: "id", tr: "tr", ar: "sa", nl: "nl", cs: "cz",
  hu: "hu", sv: "se", fi: "fi", da: "dk", no: "no", ro: "ro", el: "gr", he: "il", ca: "es-ct", bg: "bg", hr: "hr", sk: "sk",
  lt: "lt", lv: "lv", ms: "my", fa: "ir", hi: "in", eo: "eu", sr: "rs", sl: "si", ta: "in", tl: "ph", et: "ee", be: "by",
};
export function flagOf(lang: string | undefined): string | null {
  const c = lang ? LANG_FLAG[lang] : undefined;
  return c ? `https://flagcdn.com/20x15/${c}.png` : null;
}

function vnMarkup(s: string | null): string {
  return (s ?? "").replace(/\[url=[^\]]*\]([^[]*)\[\/url\]/g, "$1").replace(/\[\/?(spoiler|b|i|u|s|quote|raw|code)\]/g, "").trim();
}

function fromVndb(info: Info, v: Vn, vid: string) {
  info.sources.push("VNDB");
  const { vn } = v;
  info.description ||= vnMarkup(vn.description);
  const main = vn.titles.find((t) => t.main);
  if (!info.titles.length) {
    info.titles.push({ label: "Titre", value: vn.title });
    if (main && main.title !== vn.title) info.titles.push({ label: "Original", value: main.title });
  }
  info.synonyms.push(...vn.titles.filter((t) => !t.main).map((t) => t.title), ...vn.aliases);
  if (vn.released && !info.facts.some((f) => f.label === "Sortie")) info.facts.push({ label: "Sortie", value: isoToFr(vn.released) });
  if (vn.length_minutes) info.facts.push({ label: "Durée de lecture", value: `≈ ${Math.round(vn.length_minutes / 60)} h` });
  if (vn.rating) info.facts.push({ label: "Note VNDB", value: `${(vn.rating / 10).toFixed(1)} / 10` });
  info.tags.push(...vn.tags.filter((t) => t.rating >= 1.5).sort((a, b) => b.rating - a.rating).slice(0, 20).map((t) => ({ name: t.name, rank: Math.round((t.rating / 3) * 100), spoiler: t.spoiler > 0 })));
  const safe = vn.screenshots.filter((s) => s.sexual < 0.5 && s.violence < 0.5 && s.dims[0] >= s.dims[1]);
  info.banner ??= safe[0]?.url ?? null;

  // Développeurs (des éditions officielles), puis éditeurs par langue, fan-trads comprises (comme la fiche VNDB).
  const devs = new Set<string>(vn.developers.map((d) => d.name));
  for (const d of devs) info.companies.push({ role: "Développeur", name: d });
  const pubs = new Map<string, { name: string; lang: string; fan: boolean }>();
  for (const r of v.releases) {
    for (const l of r.languages) {
      if (l.mtl) continue;
      for (const p of r.producers) {
        if (!p.publisher) continue;
        const key = `${l.lang}:${p.name}`;
        if (!pubs.has(key)) pubs.set(key, { name: p.name, lang: l.lang, fan: !r.official });
      }
    }
  }
  const langOrder = (l: string) => (l === "ja" ? 0 : l === "en" ? 1 : l === "fr" ? 2 : 3);
  for (const p of [...pubs.values()].sort((a, b) => langOrder(a.lang) - langOrder(b.lang) || a.lang.localeCompare(b.lang))) {
    info.companies.push({ role: "Éditeur", name: p.name, lang: p.lang, fan: p.fan });
  }

  if (!info.characters.length) {
    const va = new Map(vn.va.map((x) => [x.character.id, x.staff.name]));
    const ROLE: Record<string, string> = { main: "Protagoniste", primary: "Principal", side: "Secondaire", appears: "Apparition" };
    const rank: Record<string, number> = { main: 0, primary: 1, side: 2, appears: 3 };
    info.characters.push(
      ...v.characters
        .map((c) => ({ c, role: c.vns.find((x) => x.id === vid)?.role ?? "appears" }))
        .filter(({ role }) => role !== "appears")
        .sort((a, b) => rank[a.role] - rank[b.role])
        .slice(0, 12)
        .map(({ c, role }) => ({
          name: c.name,
          image: c.image && c.image.sexual < 1 ? c.image.url : "",
          role: ROLE[role] ?? role,
          va: va.get(c.id) ? { name: va.get(c.id)!, image: "" } : undefined,
        })),
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Steam (description, développeurs, éditeurs, bannière « library hero »)

type SteamApp = {
  short_description: string;
  developers?: string[];
  publishers?: string[];
  genres?: { description: string }[];
  release_date?: { date: string };
  hero: string | null;
};

async function steam(appid: number): Promise<SteamApp | null> {
  return cached(`steam:${appid}`, 30, async () => {
    const r = await json<Record<string, { success: boolean; data?: Omit<SteamApp, "hero"> }>>(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&l=french&cc=FR&filters=basic,developers,publishers,genres,release_date`,
    );
    const d = r[appid]?.data;
    if (!d) return null;
    const hero = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg`;
    const ok = await fetch(hero, { method: "HEAD", signal: AbortSignal.timeout(8000) }).then((x) => x.ok).catch(() => false);
    return { short_description: d.short_description, developers: d.developers, publishers: d.publishers, genres: d.genres, release_date: d.release_date, hero: ok ? hero : null };
  });
}

// Jeu sans id Steam (importé de Backloggd) : la fiche Steam au titre identique, s'il y en a une.
async function steamLookup(title: string): Promise<number | null> {
  return cached(`steamsearch:${normTitle(title)}`, 60, async () => {
    const r = await json<{ items: { id: number; name: string; type: string }[] }>(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=FR`,
    );
    const own = normTitle(title);
    return r.items.find((i) => i.type === "app" && normTitle(i.name) === own)?.id ?? null;
  });
}

function fromSteam(info: Info, s: SteamApp) {
  info.sources.push("Steam");
  info.description ||= stripHtml(s.short_description);
  if (s.release_date?.date) info.facts.push({ label: "Sortie (Steam)", value: s.release_date.date });
  info.genres.push(...(s.genres ?? []).map((g) => g.description));
  // VNDB donne déjà les développeurs et éditeurs d'un VN, langue par langue.
  if (!info.companies.some((c) => c.role === "Développeur")) for (const d of s.developers ?? []) info.companies.push({ role: "Développeur", name: d });
  if (!info.companies.some((c) => c.role === "Éditeur")) for (const p of s.publishers ?? []) info.companies.push({ role: "Éditeur", name: p });
}

// ---------------------------------------------------------------------------------------------
// IGDB (bannières « artworks » des jeux, sociétés) : facultatif, demande une appli Twitch
// (TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET sur dev.twitch.tv).

export async function igdbToken(): Promise<string | null> {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) return null;
  const row = await get<{ data: string; fetched_at: number }>("SELECT data, fetched_at FROM info_cache WHERE key = 'igdb:token'");
  if (row) {
    const t = JSON.parse(row.data) as { token: string; expires: number };
    if (t.expires > Date.now() / 1000 + 3600) return t.token;
  }
  const r = await json<{ access_token: string; expires_in: number }>(
    `https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`,
    { method: "POST" },
  );
  const now = Math.floor(Date.now() / 1000);
  await run("INSERT OR REPLACE INTO info_cache (key, data, fetched_at) VALUES ('igdb:token', ?, ?)", [JSON.stringify({ token: r.access_token, expires: now + r.expires_in }), now]);
  return r.access_token;
}

type Named = { id?: number; name: string };
type IgdbGame = {
  id: number;
  name: string;
  url?: string;
  summary?: string;
  storyline?: string;
  total_rating?: number;
  total_rating_count?: number;
  first_release_date?: number;
  artworks?: { image_id: string }[];
  screenshots?: { image_id: string }[];
  involved_companies?: { developer: boolean; publisher: boolean; company: Named }[];
  genres?: Named[];
  themes?: Named[];
  game_modes?: Named[];
  player_perspectives?: Named[];
  collections?: Named[];
  franchises?: Named[];
  game_engines?: Named[];
  keywords?: Named[];
  alternative_names?: { name: string; comment?: string }[];
  game_localizations?: { name: string; region?: Named }[];
  release_dates?: { date?: number; human?: string; platform?: Named }[];
  parent_game?: { id: number; name: string };
  ttb?: { hastily?: number; normally?: number; completely?: number; count?: number } | null;
  series?: IgdbCollection[];
  origins?: number[]; // jeux dont celui-ci est une version (remake, édition étendue, portage…)
  sequels?: { relation: "Préquelle" | "Suite"; name: string; url?: string; cover?: { image_id: string }; first_release_date?: number }[];
};
type IgdbCollection = {
  id: number;
  name: string;
  games?: { id: number; name: string; game_type?: number; first_release_date?: number; cover?: { image_id: string }; url?: string; version_parent?: number; parent_game?: number }[];
};
// Types IGDB gardés dans une série : jeu principal, extension autonome, remake, remaster, version étendue
// (pas les DLC, portages, éditions ni compilations).
const SERIES_TYPES: Record<number, string> = { 0: "", 4: "Extension autonome", 8: "Remake", 9: "Remaster", 10: "Version étendue" };

const IGDB_FIELDS = [
  "id", "name", "url", "summary", "storyline", "total_rating", "total_rating_count", "first_release_date", "artworks.image_id",
  "screenshots.image_id", "involved_companies.developer", "involved_companies.publisher", "involved_companies.company.name", "genres.name",
  "themes.name", "game_modes.name", "player_perspectives.name", "collections.name", "franchises.name", "game_engines.name", "keywords.name",
  "alternative_names.name", "alternative_names.comment", "game_localizations.name", "game_localizations.region.name", "release_dates.date",
  "release_dates.human", "release_dates.platform.name", "parent_game.name", "game_type",
].join(", ");

// Une édition (portage, remaster) renvoie à son jeu parent, souvent plus complet : listes fusionnées, champs vides
// complétés par le parent.
function mergeIgdb(g: IgdbGame, parent: IgdbGame | undefined): IgdbGame {
  if (!parent) return g;
  const out: IgdbGame = { ...parent, ...Object.fromEntries(Object.entries(g).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))) } as IgdbGame;
  for (const k of ["genres", "themes", "game_modes", "player_perspectives", "collections", "franchises", "game_engines", "keywords", "alternative_names", "game_localizations"] as const) {
    const all = [...((g[k] as Named[] | undefined) ?? []), ...((parent[k] as Named[] | undefined) ?? [])];
    (out as Record<string, unknown>)[k] = all.filter((x, i) => all.findIndex((y) => y.name === x.name) === i);
  }
  // Sorties de l'édition et du jeu d'origine (la plus ancienne par plateforme est retenue à l'affichage).
  out.release_dates = [...(g.release_dates ?? []), ...(parent.release_dates ?? [])];
  return out;
}

const GENRE_IGDB: Record<string, string> = {
  "Role-playing (RPG)": "RPG", Adventure: "Aventure", Shooter: "Tir", Platform: "Plateforme", Racing: "Course", Strategy: "Stratégie",
  Fighting: "Combat", Simulator: "Simulation", Sport: "Sport", "Hack and slash/Beat 'em up": "Beat'em all", "Point-and-click": "Point & click",
  Tactical: "Tactique", Indie: "Indé", Music: "Musique", "Card & Board Game": "Cartes et plateau", "Real Time Strategy (RTS)": "Stratégie en temps réel",
  "Turn-based strategy (TBS)": "Stratégie au tour par tour", Puzzle: "Réflexion", "Quiz/Trivia": "Quiz", "Visual Novel": "Visual novel",
  Action: "Action", Fantasy: "Fantasy", "Science fiction": "Science-fiction", Horror: "Horreur", Survival: "Survie", Historical: "Historique",
  Stealth: "Infiltration", Comedy: "Comédie", Drama: "Drame", Educational: "Éducatif", Kids: "Enfants", "Open world": "Monde ouvert",
  Warfare: "Guerre", Erotic: "Érotique", Mystery: "Mystère", Romance: "Romance", Party: "Party game", "Non-fiction": "Documentaire",
  "Single player": "Solo", Multiplayer: "Multijoueur", "Co-operative": "Coopération", "Split screen": "Écran partagé",
  "Massively Multiplayer Online (MMO)": "MMO", "Battle Royale": "Battle royale", "First person": "Première personne",
  "Third person": "Troisième personne", "Bird view / Isometric": "Vue de dessus / isométrique", "Side view": "Vue de côté", Text: "Texte",
  Auditory: "Audio", "Virtual Reality": "Réalité virtuelle",
};
const REGION_FR: Record<string, string> = {
  Japan: "Japon", Korea: "Corée", China: "Chine", Europe: "Europe", "North America": "Amérique du Nord", Brazil: "Brésil", Australia: "Australie",
  "New Zealand": "Nouvelle-Zélande", Asia: "Asie", Worldwide: "Monde", Taiwan: "Taïwan",
};
const ALT_FR: Record<string, string> = {
  Acronym: "Acronyme", Abbreviation: "Abréviation", "Japanese title - romanization": "Japonais (romaji)", "Japanese title - original title": "Japonais",
  "Japanese title - translated": "Japonais (traduit)", "Chinese title - simplified": "Chinois simplifié", "Chinese title - traditional": "Chinois traditionnel",
  "Korean title": "Coréen", "Alternative spelling": "Autre graphie", "Alternative title": "Autre titre", "Stylized title": "Titre stylisé",
  "Working title": "Titre de travail", "Russian title": "Russe", "Other": "Autre titre",
};
const fr = (s: string) => GENRE_IGDB[s] ?? s;

// Par l'id Steam (de la fiche ou retrouvé par le titre) ; sinon recherche par titre, le titre identique d'abord.
async function igdb(m: Media, appid: number | null): Promise<IgdbGame | null> {
  if (!process.env.TWITCH_CLIENT_ID) return null;
  return cached(`igdb7:${appid ? `steam:${appid}` : normTitle(m.title)}`, 30, async () => {
    const token = await igdbToken();
    if (!token) return null;
    const fields = `fields ${IGDB_FIELDS};`;
    const query = <T,>(endpoint: string, body: string) =>
      json<T[]>(`https://api.igdb.com/v4/${endpoint}`, {
        method: "POST",
        headers: { "Client-ID": process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token}` },
        body,
      });
    let g: IgdbGame | undefined = appid
      ? (await query<IgdbGame>("games", `${fields} where external_games.uid = "${appid}" & external_games.external_game_source = 1; limit 1;`))[0]
      : undefined;
    if (!g) {
      const r = await query<IgdbGame>("games", `search "${m.title.replace(/"/g, "")}"; ${fields} limit 5;`);
      g = r.find((x) => normTitle(x.name) === normTitle(m.title)) ?? r[0];
    }
    if (!g) return null;
    const parent = g.parent_game ? (await query<IgdbGame>("games", `${fields} where id = ${g.parent_game.id};`))[0] : undefined;
    const merged = mergeIgdb(g, parent);
    // Originaux : le parent s'il porte un autre nom (P5 pour P5 Royal), et le parent du parent (P4 pour l'édition PC de P4G).
    merged.origins = [
      g.parent_game && normTitle(g.parent_game.name) !== normTitle(g.name) ? g.parent_game.id : 0,
      parent?.parent_game?.id ?? 0,
    ].filter(Boolean);
    // Temps pour finir (soumissions des joueurs), de l'édition sinon du jeu parent.
    const ids = [g.id, parent?.id].filter(Boolean).join(",");
    const ttb = await query<{ game_id: number; hastily?: number; normally?: number; completely?: number; count?: number }>(
      "game_time_to_beats",
      `fields game_id, hastily, normally, completely, count; where game_id = (${ids});`,
    ).catch(() => []);
    // Le relevé qui a le plus de réponses (souvent celui du jeu d'origine).
    merged.ttb = ttb.filter((x) => x.count).sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0] ?? null;
    // Séries (collections IGDB) et leurs jeux.
    const colIds = (merged.collections ?? []).map((c) => c.id).filter(Boolean);
    merged.series = colIds.length
      ? await query<IgdbCollection>(
          "collections",
          `fields name, games.name, games.game_type, games.first_release_date, games.cover.image_id, games.url, games.version_parent, games.parent_game; where id = (${colIds.join(",")}); limit 10;`,
        ).catch(() => [])
      : [];
    // Préquelle et suite directes : Wikidata (« précédé par » / « suivi de »), retrouvé par l'identifiant IGDB.
    const slugs = [g.url, parent?.url].map((u) => u?.match(/\/games\/([^/?#]+)/)?.[1]).filter((s): s is string => Boolean(s));
    const seq = await wikidataSequels(slugs).catch(() => null);
    if (seq && (seq.prev.length || seq.next.length)) {
      const found = await query<{ slug: string; name: string; url?: string; cover?: { image_id: string }; first_release_date?: number }>(
        "games",
        `fields slug, name, url, cover.image_id, first_release_date; where slug = (${[...seq.prev, ...seq.next].map((s) => `"${s}"`).join(",")}); limit 10;`,
      ).catch(() => []);
      merged.sequels = [
        ...found.filter((x) => seq.prev.includes(x.slug)).map((x) => ({ ...x, relation: "Préquelle" as const })),
        ...found.filter((x) => seq.next.includes(x.slug)).map((x) => ({ ...x, relation: "Suite" as const })),
      ];
    }
    return merged;
  });
}

// Wikidata : jeux qui précèdent (P155) et suivent (P156) celui-ci, désignés par leur identifiant IGDB (P5794).
async function wikidataSequels(slugs: string[]): Promise<{ prev: string[]; next: string[] } | null> {
  if (!slugs.length) return null;
  const sparql = `SELECT ?prevIgdb ?nextIgdb WHERE {
    VALUES ?s { ${slugs.map((s) => `"${s.replace(/"/g, "")}"`).join(" ")} }
    ?g wdt:P5794 ?s .
    OPTIONAL { ?g wdt:P155 ?prev . ?prev wdt:P5794 ?prevIgdb . }
    OPTIONAL { ?g wdt:P156 ?next . ?next wdt:P5794 ?nextIgdb . }
  } LIMIT 20`;
  const r = await json<{ results: { bindings: { prevIgdb?: { value: string }; nextIgdb?: { value: string } }[] } }>(
    `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`,
    { headers: { Accept: "application/sparql-results+json" } },
  );
  const b = r.results.bindings;
  return {
    prev: [...new Set(b.map((x) => x.prevIgdb?.value).filter((v): v is string => Boolean(v)))],
    next: [...new Set(b.map((x) => x.nextIgdb?.value).filter((v): v is string => Boolean(v)))],
  };
}

function fromIgdb(info: Info, g: IgdbGame) {
  info.sources.push("IGDB");
  const art = g.artworks?.[0]?.image_id ?? g.screenshots?.[0]?.image_id;
  // Bannière IGDB en priorité pour les jeux (comme Backloggd).
  if (art) info.banner = `https://images.igdb.com/igdb/image/upload/t_1080p/${art}.jpg`;
  info.description ||= g.summary ?? "";
  if (g.storyline && g.storyline !== info.description) info.story = g.storyline;
  if (!info.companies.some((c) => c.role === "Développeur" || c.role === "Éditeur")) {
    for (const c of g.involved_companies ?? []) {
      if (c.developer) info.companies.push({ role: "Développeur", name: c.company.name });
      if (c.publisher) info.companies.push({ role: "Éditeur", name: c.company.name });
    }
  }
  const f = info.facts;
  const list = (label: string, items: Named[] | undefined) => items?.length && f.push({ label, value: items.map((x) => fr(x.name)).join(", ") });
  if (g.first_release_date && !f.some((x) => x.label.startsWith("Sortie"))) {
    f.push({ label: "Sortie", value: isoToFr(new Date(g.first_release_date * 1000).toISOString().slice(0, 10)) });
  }
  if (g.total_rating) f.push({ label: "Note IGDB", value: `${Math.round(g.total_rating)} %${g.total_rating_count ? ` (${g.total_rating_count} votes)` : ""}` });
  list("Thèmes", g.themes);
  list("Modes de jeu", g.game_modes);
  list("Perspective", g.player_perspectives);
  list("Série", g.collections);
  list("Franchises", g.franchises);
  list("Moteur", g.game_engines);
  info.genres.push(...(g.genres ?? []).map((x) => fr(x.name)));
  info.keywords.push(...(g.keywords ?? []).map((k) => k.name));
  for (const l of g.game_localizations ?? []) {
    if (l.name) info.titles.push({ label: REGION_FR[l.region?.name ?? ""] ?? l.region?.name ?? "Titre localisé", value: l.name });
  }
  // Noms alternatifs, sans les noms de fichiers que la base garde aussi (« Windows Executable : boot.bat »).
  for (const a of g.alternative_names ?? []) {
    if (!a.name || /executable|file ?name/i.test(a.comment ?? "") || /\.(exe|bat|app|elf)$/i.test(a.name)) continue;
    info.titles.push({ label: ALT_FR[a.comment ?? ""] ?? a.comment ?? "Autre titre", value: a.name });
  }
  // Sorties : la plus ancienne date par plateforme.
  const byPlatform = new Map<string, { date: number; human: string }>();
  for (const r of g.release_dates ?? []) {
    const name = r.platform?.name;
    if (!name || !r.date) continue;
    const cur = byPlatform.get(name);
    if (!cur || r.date < cur.date) byPlatform.set(name, { date: r.date, human: isoToFr(new Date(r.date * 1000).toISOString().slice(0, 10)) });
  }
  info.releases = [...byPlatform].sort((a, b) => a[1].date - b[1].date).map(([platform, d]) => ({ platform, date: d.human }));
  if (g.ttb && (g.ttb.hastily || g.ttb.normally || g.ttb.completely)) {
    const h = (s?: number) => (s ? Math.round(s / 3600) : 0);
    info.timeToBeat = { hastily: h(g.ttb.hastily), normally: h(g.ttb.normally), completely: h(g.ttb.completely), count: g.ttb.count ?? 0 };
  }
  if (g.url) info.links.push(["IGDB", g.url]);
  info.gameRelations = (g.sequels ?? []).map((x) => ({
    name: x.name,
    year: x.first_release_date ? new Date(x.first_release_date * 1000).getUTCFullYear() : null,
    cover: x.cover ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${x.cover.image_id}.jpg` : "",
    url: x.url ?? "",
    type: "",
    relation: x.relation,
  }));
  // Autres jeux de la série, la série la plus précise d'abord (« Persona 4 » avant « Persona »).
  // Le jeu lui-même (et son parent s'il porte le même nom, comme une édition PC) ; Persona 5 reste dans la série de
  // Persona 5 Royal.
  const self = new Set([g.id, normTitle(g.parent_game?.name ?? "") === normTitle(g.name) ? g.parent_game?.id : undefined].filter(Boolean));
  const family = new Set([g.id, g.parent_game?.id, ...(g.origins ?? [])].filter((x): x is number => Boolean(x)));
  for (const c of [...(g.series ?? [])].sort((a, b) => (a.games?.length ?? 0) - (b.games?.length ?? 0))) {
    const games = (c.games ?? [])
      .filter((x) => x.game_type != null && x.game_type in SERIES_TYPES && !x.version_parent && !self.has(x.id) && normTitle(x.name) !== normTitle(g.name))
      .sort((a, b) => (a.first_release_date ?? 9e12) - (b.first_release_date ?? 9e12))
      .map((x) => ({
        name: x.name,
        year: x.first_release_date ? new Date(x.first_release_date * 1000).getUTCFullYear() : null,
        cover: x.cover ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${x.cover.image_id}.jpg` : "",
        url: x.url ?? "",
        type: SERIES_TYPES[x.game_type!],
        // « Remake », « Remaster »… seulement pour les versions du même jeu (celui-ci ou son original) ; les remakes
        // d'autres jeux de la série restent « Même série ».
        relation: (g.origins ?? []).includes(x.id)
          ? "Original"
          : x.parent_game && family.has(x.parent_game) && SERIES_TYPES[x.game_type!]
            ? SERIES_TYPES[x.game_type!]
            : "Même série",
      }));
    if (games.length) info.gameSeries.push({ name: c.name, games: games.slice(0, 40) });
  }
}

// Personnages d'un jeu : AniList ne liste pas les jeux, mais leurs adaptations (anime, manga) ont les personnages.
// On cherche une adaptation dont la source est un jeu ou un VN et dont le titre contient tous les mots du jeu ;
// sans résultat, on retire les derniers mots (« Persona 5 Royal » → « Persona 5 »).
const titleWords = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/(\p{L})(\p{N})|(\p{N})(\p{L})/gu, "$1$3 $2$4").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

async function anilistGameAdaptation(title: string): Promise<number | null> {
  return cached(`algame:${normTitle(title)}`, 30, async () => {
    const words = titleWords(title.split(/[:：]/)[0]);
    for (let n = words.length; n >= 1; n--) {
      const q = words.slice(0, n);
      if (q.join("").length < 5 || (n < words.length && n < 2)) break;
      const r = await json<{ data: { Page: { media: { id: number; type: string; format: string | null; popularity: number; source: string | null; title: { romaji: string | null; english: string | null }; synonyms: string[] }[] } } }>(
        "https://graphql.anilist.co",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            query: "query ($s: String) { Page(perPage: 10) { media(search: $s, sort: SEARCH_MATCH) { id type format popularity source(version: 3) title { romaji english } synonyms } } }",
            variables: { s: q.join(" ") },
          }),
        },
      );
      const hits = r.data.Page.media
        .filter((x) => ["VIDEO_GAME", "VISUAL_NOVEL", "GAME"].includes(x.source ?? ""))
        .filter((x) => [x.title.romaji, x.title.english, ...x.synonyms].some((s) => s && q.every((w) => titleWords(s).includes(w))))
        // Un anime d'abord (série TV avant les spéciaux), puis le plus populaire.
        .sort((a, b) => Number(b.type === "ANIME") - Number(a.type === "ANIME") || Number(b.format === "TV") - Number(a.format === "TV") || b.popularity - a.popularity);
      if (hits[0]) return hits[0].id;
    }
    return null;
  });
}

// ---------------------------------------------------------------------------------------------
// SteamGridDB (jaquettes et bannières des jeux) : facultatif, clé sur steamgriddb.com/profile/preferences/api.

async function sgdb<T>(path: string): Promise<T | null> {
  const key = process.env.STEAMGRIDDB_KEY;
  if (!key) return null;
  const r = await json<{ success: boolean; data: T }>(`https://www.steamgriddb.com/api/v2/${path}`, { headers: { Authorization: `Bearer ${key}` } });
  return r.success ? r.data : null;
}

async function sgdbGameId(m: { title: string; steam_id: number | null }): Promise<number | null> {
  if (!process.env.STEAMGRIDDB_KEY) return null;
  return cached(`sgdb:id:${m.steam_id ?? normTitle(m.title)}`, 60, async () => {
    if (m.steam_id) {
      const g = await sgdb<{ id: number }>(`games/steam/${m.steam_id}`).catch(() => null);
      if (g) return g.id;
    }
    const s = await sgdb<{ id: number; name: string }[]>(`search/autocomplete/${encodeURIComponent(m.title)}`);
    return s?.[0]?.id ?? null;
  });
}

// Jaquettes 600×900 de SteamGridDB, pour « Voir d'autres couvertures ».
export async function sgdbCovers(m: { title: string; steam_id: number | null }): Promise<string[]> {
  const id = await sgdbGameId(m).catch(() => null);
  if (!id) return [];
  const grids = await sgdb<{ url: string }[]>(`grids/game/${id}?dimensions=600x900&types=static&nsfw=false`).catch(() => null);
  return (grids ?? []).slice(0, 24).map((g) => g.url);
}

async function sgdbHero(m: Media): Promise<string | null> {
  const id = await sgdbGameId(m).catch(() => null);
  if (!id) return null;
  return cached(`sgdb:hero:${id}`, 30, async () => {
    const heroes = await sgdb<{ url: string }[]>(`heroes/game/${id}?types=static&nsfw=false`);
    return heroes?.[0]?.url ?? null;
  });
}

// ---------------------------------------------------------------------------------------------
// PCGamingWiki : liste des traductions françaises de fans (jeu, groupe, lien).

type FanTrad = { title: string; group: string; url: string };

async function pcgwFrench(): Promise<FanTrad[] | null> {
  return cached("pcgw:fr", 7, async () => {
    const r = await json<{ parse: { text: { "*": string } } }>(
      "https://www.pcgamingwiki.com/w/api.php?action=parse&page=List_of_French_fan_translations&prop=text&format=json",
    );
    const out: FanTrad[] = [];
    for (const row of r.parse.text["*"].match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
      const cells = row.match(/<td[\s\S]*?<\/td>/g);
      if (!cells || cells.length < 8) continue;
      const title = stripHtml(cells[0]);
      const notes = cells[cells.length - 1];
      const by = /(?:translation|traduction)\s+(?:by|par)\s+(?:the\s+)?"?([^;,."<]+)/i.exec(stripHtml(notes));
      const url = /href="(https?:[^"]+)"/.exec(notes)?.[1] ?? "";
      out.push({ title, group: by?.[1].trim() ?? "", url });
    }
    return out;
  });
}

// ---------------------------------------------------------------------------------------------
// TMDB (films) et TVmaze (séries)

async function tmdbJson<T>(path: string): Promise<T | null> {
  const token = process.env.TMDB_TOKEN;
  if (!token) return null;
  const v3 = /^[0-9a-f]{32}$/i.test(token);
  const sep = path.includes("?") ? "&" : "?";
  return json<T>(`https://api.themoviedb.org/3/${path}${v3 ? `${sep}api_key=${token}` : ""}`, v3 ? {} : { headers: { Authorization: `Bearer ${token}` } });
}

type TmdbMovie = {
  title: string;
  original_title: string;
  overview: string;
  backdrop_path: string | null;
  release_date: string;
  runtime: number | null;
  genres: { name: string }[];
  vote_average: number;
  production_companies: { name: string }[];
  credits: { cast: { name: string; character: string; profile_path: string | null }[]; crew: { name: string; job: string }[] };
  alternative_titles: { titles: { title: string; iso_3166_1: string }[] };
};

function fromTmdb(info: Info, t: TmdbMovie) {
  info.sources.push("TMDB");
  if (t.backdrop_path) info.banner = `https://image.tmdb.org/t/p/w1280${t.backdrop_path}`;
  info.description ||= t.overview;
  if (t.release_date) info.facts.push({ label: "Sortie", value: isoToFr(t.release_date) });
  if (t.runtime) info.facts.push({ label: "Durée", value: `${Math.floor(t.runtime / 60)} h ${String(t.runtime % 60).padStart(2, "0")}` });
  if (t.vote_average) info.facts.push({ label: "Note TMDB", value: `${t.vote_average.toFixed(1)} / 10` });
  info.genres.push(...t.genres.map((g) => g.name));
  info.titles.push({ label: "Titre", value: t.title });
  if (t.original_title !== t.title) info.titles.push({ label: "Original", value: t.original_title });
  info.synonyms.push(...t.alternative_titles.titles.map((x) => x.title));
  for (const c of t.credits.crew.filter((c) => c.job === "Director")) info.companies.push({ role: "Réalisation", name: c.name });
  for (const c of t.production_companies) info.companies.push({ role: "Production", name: c.name });
  info.characters.push(
    ...t.credits.cast.slice(0, 12).map((c) => ({
      name: c.character || c.name,
      image: "",
      role: "",
      va: { name: c.name, image: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : "" },
    })),
  );
}

type TvShow = {
  name: string;
  summary: string | null;
  genres: string[];
  premiered: string | null;
  ended: string | null;
  status: string;
  averageRuntime: number | null;
  network: { name: string } | null;
  webChannel: { name: string } | null;
  _embedded: {
    cast: { person: { name: string; image: { medium: string } | null }; character: { name: string; image: { medium: string } | null } }[];
    images: { type: string; main: boolean; resolutions: { original: { url: string; width: number } } }[];
  };
};

function fromTvmaze(info: Info, s: TvShow) {
  info.sources.push("TVmaze");
  const bg = s._embedded.images.filter((i) => i.type === "background").sort((a, b) => Number(b.main) - Number(a.main))[0];
  info.banner ??= bg?.resolutions.original.url ?? null;
  info.description ||= stripHtml(s.summary);
  if (s.premiered) info.facts.push({ label: "Début", value: isoToFr(s.premiered) });
  if (s.ended) info.facts.push({ label: "Fin", value: isoToFr(s.ended) });
  info.facts.push({ label: "Statut", value: s.status === "Ended" ? "Terminée" : s.status === "Running" ? "En cours" : s.status });
  if (s.averageRuntime) info.facts.push({ label: "Durée", value: `${s.averageRuntime} min par épisode` });
  info.genres.push(...s.genres);
  const net = s.network?.name ?? s.webChannel?.name;
  if (net) info.companies.push({ role: "Diffuseur", name: net });
  info.characters.push(
    ...s._embedded.cast.slice(0, 12).map((c) => ({
      name: c.character.name,
      image: c.character.image?.medium ?? "",
      role: "",
      va: { name: c.person.name, image: c.person.image?.medium ?? "" },
    })),
  );
}

// ---------------------------------------------------------------------------------------------
// Open Library (romans)

type OlBook = { description: string; subjects: string[]; publishers: string[]; pages: number | null; date: string };

async function openLibrary(isbn: string): Promise<OlBook | null> {
  return cached(`ol:${isbn}`, 60, async () => {
    const ed = await json<{ works?: { key: string }[]; publishers?: string[]; number_of_pages?: number; publish_date?: string }>(
      `https://openlibrary.org/isbn/${isbn}.json`,
    );
    const work = ed.works?.[0]?.key
      ? await json<{ description?: string | { value: string }; subjects?: string[] }>(`https://openlibrary.org${ed.works[0].key}.json`).catch(() => null)
      : null;
    const desc = typeof work?.description === "string" ? work.description : (work?.description?.value ?? "");
    return { description: desc, subjects: work?.subjects?.slice(0, 12) ?? [], publishers: ed.publishers ?? [], pages: ed.number_of_pages ?? null, date: ed.publish_date ?? "" };
  });
}

// ---------------------------------------------------------------------------------------------

// related : ids AniList des adaptations de l'œuvre dans la bibliothèque (anime, manga), pour les personnages d'un jeu.
export async function getInfo(m: Media, related: number[] = []): Promise<Info> {
  const info = emptyInfo();
  const safe = <T,>(p: Promise<T>) => p.catch(() => null);

  if (m.anilist_id && (m.kind === "anime" || m.kind === "manga" || m.kind === "ln")) {
    const [a, themes] = await Promise.all([safe(anilist(m.anilist_id)), m.kind === "anime" ? safe(animethemes(m.anilist_id)) : null]);
    if (a) fromAnilist(info, a);
    if (themes) info.themes.push(...themes);
  }

  if (m.kind === "jeu") {
    // Fiche VNDB : retrouvée une fois par le titre, puis gardée sur la fiche ('-' : pas un VN).
    let vid = m.vndb_id;
    if (vid == null) {
      vid = (await safe(vndbMatch(m.title)))?.id ?? null;
      if (vid !== null || m.status !== "prevu") await run("UPDATE media SET vndb_id = ? WHERE id = ?", [vid ?? "-", m.id]);
    }
    const appid = m.steam_id ?? (await safe(steamLookup(m.title)));
    const [v, s, g, fr] = await Promise.all([
      vid && vid !== "-" ? safe(vndb(vid)) : null,
      appid ? safe(steam(appid)) : null,
      safe(igdb(m, appid)),
      safe(pcgwFrench()),
    ]);
    if (v && vid) fromVndb(info, v, vid);
    if (s) fromSteam(info, s);
    if (g) fromIgdb(info, g);
    if (!info.banner && s?.hero) info.banner = s.hero;
    if (!info.banner) info.banner = await safe(sgdbHero(m));
    // Personnages : ceux de VNDB pour un VN, sinon ceux de l'adaptation AniList du jeu.
    if (!info.characters.length) {
      const alId = related[0] ?? (await safe(anilistGameAdaptation(m.title)));
      const a = alId ? await safe(anilist(alId)) : null;
      if (a?.characters.edges.length) {
        info.characters.push(
          ...a.characters.edges.map((e) => ({
            name: e.node.name.full,
            image: e.node.image.large,
            role: CHAR_ROLE[e.role] ?? e.role,
            va: e.voiceActors[0] ? { name: e.voiceActors[0].name.full, image: e.voiceActors[0].image.large } : undefined,
          })),
        );
        info.charactersFrom = a.title.english ?? a.title.romaji ?? "";
      }
    }
    // Traductions françaises de fans (PCGamingWiki), si VNDB ne les a pas déjà.
    const names = new Set([m.title, ...info.titles.map((t) => t.value), ...info.synonyms].filter(Boolean).map(normTitle));
    for (const t of fr ?? []) {
      if (!names.has(normTitle(t.title)) || !t.group) continue;
      if (info.companies.some((c) => c.lang === "fr" && normTitle(c.name) === normTitle(t.group))) continue;
      info.companies.push({ role: "Éditeur", name: t.group, lang: "fr", fan: true, url: t.url });
    }
  }

  if (m.kind === "film" && m.tmdb_id) {
    const t = await safe(cached(`tmdb:${m.tmdb_id}`, 30, () => tmdbJson<TmdbMovie>(`movie/${m.tmdb_id}?language=fr-FR&append_to_response=credits,alternative_titles`)));
    if (t) fromTmdb(info, t);
  }

  if (m.kind === "serie" && m.tvmaze_id) {
    const s = await safe(cached(`tvmaze:${m.tvmaze_id}`, 14, () => json<TvShow>(`https://api.tvmaze.com/shows/${m.tvmaze_id}?embed[]=cast&embed[]=images`)));
    if (s) fromTvmaze(info, s);
  }

  if (m.kind === "roman" && m.isbn) {
    const b = await safe(openLibrary(m.isbn));
    if (b) {
      info.sources.push("Open Library");
      info.description ||= b.description;
      if (b.pages) info.facts.push({ label: "Pages", value: String(b.pages) });
      if (b.date) info.facts.push({ label: "Parution", value: b.date });
      info.genres.push(...b.subjects);
      for (const p of b.publishers) info.companies.push({ role: "Éditeur", name: p });
    }
  }
  if (m.author && !info.companies.some((c) => c.role === "Auteur")) info.companies.unshift({ role: "Auteur", name: m.author });

  // Titres en double (VNDB et IGDB, ou à une espace près) : une seule fois chacun.
  info.titles = info.titles.filter(
    (x, i) => x.value && normTitle(x.value) !== normTitle(m.title) && info.titles.findIndex((y) => y.value && normTitle(y.value) === normTitle(x.value)) === i,
  );
  info.synonyms = [...new Set(info.synonyms)].filter((s) => s && !info.titles.some((t) => t.value === s) && s !== m.title);
  info.keywords = [...new Set(info.keywords)];
  info.genres = [...new Set(info.genres)];
  return info;
}
