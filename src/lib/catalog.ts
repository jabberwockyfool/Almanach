import "server-only";
import type { MediaInput } from "@/lib/db";
import type { Kind } from "@/lib/kinds";
import { relatedCovers, searchAniList } from "@/lib/anilist";

// Recherche de fiches à ajouter, par type :
// anime / manga / light novel → AniList ; série → TVmaze ; film → TMDB (si TMDB_TOKEN) ; jeu → Steam ;
// roman → Open Library (titre, auteur ou ISBN ; Google Books en appoint si GOOGLE_BOOKS_KEY).
// Toutes sans clé, sauf TMDB.

export type SearchResult = MediaInput & { source: string };

const UA = "Almanach/0.1 (personal media tracker)";

export async function searchCatalog(kind: Kind, q: string): Promise<SearchResult[]> {
  q = q.trim();
  if (!q) return [];
  switch (kind) {
    case "anime":
    case "manga":
    case "ln":
      return (await searchAniList(q, kind)).map((m) => ({ ...m, source: "AniList" }));
    case "serie":
      return searchTvmaze(q);
    case "film":
      return searchTmdb(q);
    case "jeu":
      return searchSteam(q);
    case "roman":
      return searchBooks(q);
  }
}

// ISBN-10 ou ISBN-13, tirets et espaces tolérés.
export function asIsbn(q: string): string | null {
  const d = q.replace(/[\s-]/g, "").toUpperCase();
  return /^(97[89])?\d{9}[\dX]$/.test(d) ? d : null;
}

type OlDoc = { key: string; title: string; author_name?: string[]; first_publish_year?: number; isbn?: string[]; cover_i?: number; language?: string[]; number_of_pages_median?: number };

async function searchBooks(q: string): Promise<SearchResult[]> {
  const isbn = asIsbn(q);
  const params = new URLSearchParams({ limit: "12", fields: "key,title,author_name,first_publish_year,isbn,cover_i,language,number_of_pages_median" });
  if (isbn) params.set("isbn", isbn);
  else params.set("q", q);
  const res = await fetch(`https://openlibrary.org/search.json?${params}`, {
    headers: { "User-Agent": UA },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const docs = res.ok ? ((await res.json()) as { docs: OlDoc[] }).docs : [];
  const out: SearchResult[] = docs.map((d) => {
    // ISBN gardé : celui cherché, sinon un ISBN-13 de l'édition française si possible.
    const ownIsbn = isbn ?? d.isbn?.find((i) => /^9782/.test(i)) ?? d.isbn?.find((i) => i.length === 13) ?? d.isbn?.[0];
    return {
      kind: "roman" as const,
      title: d.title,
      author: d.author_name?.slice(0, 2).join(", ") ?? "",
      subtitle: d.author_name?.slice(0, 2).join(", ") ?? "",
      year: d.first_publish_year ?? null,
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : ownIsbn ? `https://covers.openlibrary.org/b/isbn/${ownIsbn}-L.jpg` : "",
      isbn: ownIsbn,
      total: d.number_of_pages_median ?? null,
      source: "Open Library",
    };
  });
  if (out.length || !process.env.GOOGLE_BOOKS_KEY) return out;
  const g = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(isbn ? `isbn:${isbn}` : q)}&maxResults=12&key=${process.env.GOOGLE_BOOKS_KEY}`,
    { cache: "no-store", signal: AbortSignal.timeout(15000) },
  );
  if (!g.ok) return out;
  const data = (await g.json()) as {
    items?: { volumeInfo: { title: string; authors?: string[]; publishedDate?: string; industryIdentifiers?: { type: string; identifier: string }[]; imageLinks?: { thumbnail?: string }; pageCount?: number } }[];
  };
  return (data.items ?? []).map(({ volumeInfo: v }) => ({
    kind: "roman" as const,
    title: v.title,
    author: v.authors?.join(", ") ?? "",
    subtitle: v.authors?.join(", ") ?? "",
    year: v.publishedDate ? Number(v.publishedDate.slice(0, 4)) : null,
    cover: v.imageLinks?.thumbnail?.replace(/^http:/, "https:") ?? "",
    isbn: v.industryIdentifiers?.find((i) => i.type === "ISBN_13")?.identifier ?? isbn ?? undefined,
    total: v.pageCount || null,
    source: "Google Books",
  }));
}

// Couvertures possibles pour une fiche : celles des fiches homonymes de sa source (éditions, saisons, versions),
// plus, pour une série, toutes les affiches connues de TVmaze et, pour un jeu Steam, ses visuels.
export async function coverCandidates(m: {
  kind: Kind;
  title: string;
  cover: string;
  tvmaze_id: number | null;
  steam_id: number | null;
  anilist_id: number | null;
}): Promise<string[]> {
  const out: string[] = [];
  if (m.anilist_id) out.push(...(await relatedCovers(m.anilist_id).catch(() => [])));
  if (m.tvmaze_id) {
    const res = await fetch(`https://api.tvmaze.com/shows/${m.tvmaze_id}/images`, { cache: "no-store" });
    if (res.ok) {
      const imgs = (await res.json()) as { type: string; resolutions: { original?: { url: string }; medium?: { url: string } } }[];
      for (const i of imgs) if (i.type === "poster") out.push(i.resolutions.original?.url ?? i.resolutions.medium?.url ?? "");
    }
  }
  if (m.steam_id) {
    const base = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${m.steam_id}`;
    out.push(`${base}/library_600x900.jpg`, `${base}/library_600x900_2x.jpg`, `${base}/header.jpg`);
  }
  // Le titre exact ne renvoie souvent que la fiche elle-même : on cherche aussi la franchise
  // (sans « Season 4 », « 2nd Season », « Part 2 », sous-titre après « : »).
  const short = m.title
    .replace(/\s*(?:[:：]\s|\s-\s).*$/, "")
    .replace(/\s+(\d+(st|nd|rd|th)\s+season|season\s+\d+|part\s+\d+|saison\s+\d+|\d+)$/i, "")
    .trim();
  for (const q of short && short !== m.title ? [m.title, short] : [m.title]) {
    const results = await searchCatalog(m.kind, q).catch(() => [] as SearchResult[]);
    for (const r of results) if (r.cover) out.push(r.cover);
  }
  return [...new Set(out.filter((c) => c && c !== m.cover))].slice(0, 24);
}

type TvmazeShow = {
  id: number;
  name: string;
  premiered: string | null;
  image: { medium: string; original: string } | null;
};

async function searchTvmaze(q: string): Promise<SearchResult[]> {
  const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`TVmaze : HTTP ${res.status}`);
  const list = (await res.json()) as { show: TvmazeShow }[];
  return list.slice(0, 12).map(({ show }) => ({
    kind: "serie" as const,
    title: show.name,
    year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
    cover: show.image?.original ?? show.image?.medium ?? "",
    tvmaze_id: show.id,
    source: "TVmaze",
  }));
}

// Nombre d'épisodes d'une série (hors épisodes spéciaux), pour la barre de progression.
export async function tvmazeEpisodeCount(id: number): Promise<number | null> {
  const res = await fetch(`https://api.tvmaze.com/shows/${id}/episodes`, { cache: "no-store" });
  if (!res.ok) return null;
  const eps = (await res.json()) as { type: string }[];
  return eps.filter((e) => e.type !== "insignificant_special").length || null;
}

async function searchTmdb(q: string): Promise<SearchResult[]> {
  const token = process.env.TMDB_TOKEN;
  if (!token) return [];
  // Les deux formats de TMDB : la clé d'API v3 (32 caractères, en paramètre) ou le jeton « Read Access » (JWT, en en-tête).
  const v3 = /^[0-9a-f]{32}$/i.test(token);
  const res = await fetch(
    `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(q)}&language=fr-FR&include_adult=false${v3 ? `&api_key=${token}` : ""}`,
    { headers: { ...(v3 ? {} : { Authorization: `Bearer ${token}` }), Accept: "application/json" }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`TMDB : HTTP ${res.status}`);
  const data = (await res.json()) as {
    results: { id: number; title: string; original_title: string; release_date: string; poster_path: string | null }[];
  };
  return data.results.slice(0, 12).map((r) => ({
    kind: "film" as const,
    title: r.title,
    subtitle: r.original_title !== r.title ? r.original_title : "",
    year: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
    cover: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : "",
    tmdb_id: r.id,
    source: "TMDB",
  }));
}

async function searchSteam(q: string): Promise<SearchResult[]> {
  const res = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=french&cc=FR`, {
    headers: { "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Steam : HTTP ${res.status}`);
  const data = (await res.json()) as { items: { id: number; name: string; type: string }[] };
  return data.items
    .filter((i) => i.type === "app")
    .slice(0, 12)
    .map((i) => ({
      kind: "jeu" as const,
      title: i.name,
      // Jaquette verticale de la bibliothèque Steam (présente pour presque tous les jeux).
      cover: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${i.id}/library_600x900.jpg`,
      steam_id: i.id,
      source: "Steam",
    }));
}
