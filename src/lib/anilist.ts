import "server-only";
import type { Kind, Status } from "@/lib/kinds";

// AniList : API GraphQL publique. Les listes d'un profil public se lisent sans compte ; l'écriture
// (SaveMediaListEntry) demande un jeton OAuth obtenu via Réglages → Connecter AniList.

const ENDPOINT = "https://graphql.anilist.co";

async function gql<T>(query: string, variables: Record<string, unknown>, token?: string): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`AniList : ${json.errors.map((e) => e.message).join(", ")}`);
  if (!json.data) throw new Error(`AniList : réponse vide (HTTP ${res.status})`);
  return json.data;
}

type FuzzyDate = { year: number | null; month: number | null; day: number | null };

type AniMedia = {
  id: number;
  type: "ANIME" | "MANGA";
  format: string | null;
  episodes: number | null;
  chapters: number | null;
  volumes: number | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  coverImage: { extraLarge: string | null; large: string | null };
  startDate: FuzzyDate;
};

const MEDIA_FIELDS = `id type format episodes chapters volumes
  title { romaji english native } coverImage { extraLarge large } startDate { year month day }`;

export function kindOf(m: Pick<AniMedia, "type" | "format">): Kind {
  if (m.type === "ANIME") return "anime";
  return m.format === "NOVEL" ? "ln" : "manga";
}

// Les dates floues d'AniList peuvent n'avoir que l'année, ou l'année et le mois : on garde ce qui est connu.
export function fuzzyToIso(d: FuzzyDate | null | undefined): string | null {
  if (!d?.year) return null;
  if (!d.month) return String(d.year);
  const ym = `${d.year}-${String(d.month).padStart(2, "0")}`;
  return d.day ? `${ym}-${String(d.day).padStart(2, "0")}` : ym;
}

function isoToFuzzy(iso: string | null | undefined): FuzzyDate | null {
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month: month || null, day: day || null };
}

export function mediaFields(m: AniMedia) {
  const kind = kindOf(m);
  return {
    kind,
    title: m.title.romaji || m.title.english || m.title.native || "Sans titre",
    subtitle: m.title.english && m.title.english !== m.title.romaji ? m.title.english : (m.title.native ?? ""),
    year: m.startDate?.year ?? null,
    cover: m.coverImage.extraLarge || m.coverImage.large || "",
    total: kind === "anime" ? m.episodes : kind === "ln" ? m.volumes : m.chapters,
    anilist_id: m.id,
    format: m.format,
  };
}

export async function searchAniList(search: string, kind: "anime" | "manga" | "ln") {
  const query = `query ($search: String, $type: MediaType, $formatIn: [MediaFormat], $formatNotIn: [MediaFormat]) {
    Page(perPage: 12) { media(search: $search, type: $type, format_in: $formatIn, format_not_in: $formatNotIn, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} } }
  }`;
  const data = await gql<{ Page: { media: AniMedia[] } }>(query, {
    search,
    type: kind === "anime" ? "ANIME" : "MANGA",
    formatIn: kind === "ln" ? ["NOVEL"] : undefined,
    formatNotIn: kind === "manga" ? ["NOVEL"] : undefined,
  });
  return data.Page.media.map(mediaFields);
}

// Relations d'un lot de fiches (50 par requête) : type « version 2 » d'AniList, qui distingue SOURCE
// (l'œuvre adaptée) d'ADAPTATION.
// Avec, pour chaque fiche, sa source (VISUAL_NOVEL…) et tous ses titres.
export type FamilyInfo = {
  relations: { id: number; target: number; type: string }[];
  info: { id: number; source: string | null; format: string | null; titles: string[] }[];
};

export async function fetchRelations(ids: number[]): Promise<FamilyInfo> {
  const out: FamilyInfo = { relations: [], info: [] };
  for (let i = 0; i < ids.length; i += 50) {
    const data = await gql<{
      Page: {
        media: {
          id: number;
          source: string | null;
          format: string | null;
          synonyms: string[];
          title: { romaji: string | null; english: string | null; native: string | null };
          relations: { edges: { relationType: string; node: { id: number } }[] };
        }[];
      };
    }>(
      `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids) {
        id source(version: 3) format synonyms title { romaji english native }
        relations { edges { relationType(version: 2) node { id } } } } } }`,
      { ids: ids.slice(i, i + 50) },
    );
    for (const m of data.Page.media) {
      for (const e of m.relations.edges) out.relations.push({ id: m.id, target: e.node.id, type: e.relationType });
      const titles = [m.title.romaji, m.title.english, m.title.native, ...m.synonyms].filter((t): t is string => Boolean(t));
      out.info.push({ id: m.id, source: m.source, format: m.format, titles });
    }
  }
  return out;
}

// Couvertures des œuvres liées (autres saisons, manga ou light novel d'origine, adaptations…).
export async function relatedCovers(id: number): Promise<string[]> {
  const data = await gql<{ Media: { relations: { nodes: { coverImage: { extraLarge: string | null; large: string | null } }[] } } }>(
    `query ($id: Int) { Media(id: $id) { relations { nodes { coverImage { extraLarge large } } } } }`,
    { id },
  );
  return data.Media.relations.nodes.map((n) => n.coverImage.extraLarge || n.coverImage.large || "").filter(Boolean);
}

export const STATUS_FROM_ANILIST: Record<string, Status> = {
  CURRENT: "en_cours",
  REPEATING: "en_cours",
  PLANNING: "prevu",
  COMPLETED: "termine",
  PAUSED: "pause",
  DROPPED: "abandonne",
};

const STATUS_TO_ANILIST: Record<Status, string> = {
  en_cours: "CURRENT",
  prevu: "PLANNING",
  termine: "COMPLETED",
  pause: "PAUSED",
  abandonne: "DROPPED",
};

export type AniEntry = {
  id: number;
  status: string;
  progress: number | null;
  progressVolumes: number | null;
  score: number | null;
  repeat: number | null;
  notes: string | null;
  startedAt: FuzzyDate;
  completedAt: FuzzyDate;
  media: AniMedia;
};

export async function fetchUserLists(userName: string): Promise<AniEntry[]> {
  const query = `query ($userName: String, $type: MediaType) {
    MediaListCollection(userName: $userName, type: $type) {
      lists { entries { id status progress progressVolumes score(format: POINT_10_DECIMAL) repeat notes
        startedAt { year month day } completedAt { year month day } media { ${MEDIA_FIELDS} } } }
    }
  }`;
  const out: AniEntry[] = [];
  for (const type of ["ANIME", "MANGA"]) {
    const data = await gql<{ MediaListCollection: { lists: { entries: AniEntry[] }[] } }>(query, { userName, type });
    for (const list of data.MediaListCollection.lists) out.push(...list.entries);
  }
  // Une entrée peut figurer dans plusieurs listes personnalisées.
  return [...new Map(out.map((e) => [e.id, e])).values()];
}

// Favoris (dans l'ordre choisi sur AniList) et critiques publiées d'un profil public.
export async function fetchProfileExtras(userName: string): Promise<{
  favourites: { anime: number[]; manga: number[] };
  reviews: { mediaId: number; summary: string; body: string; score: number }[];
}> {
  const u = await gql<{
    User: { id: number; favourites: { anime: { nodes: { id: number }[] }; manga: { nodes: { id: number }[] } } };
  }>(
    `query ($n: String) { User(name: $n) { id favourites {
      anime(perPage: 25) { nodes { id } } manga(perPage: 25) { nodes { id } } } } }`,
    { n: userName },
  );
  const reviews: { mediaId: number; summary: string; body: string; score: number }[] = [];
  for (let page = 1; page <= 4; page++) {
    const d = await gql<{ Page: { pageInfo: { hasNextPage: boolean }; reviews: { mediaId: number; summary: string; body: string; score: number }[] } }>(
      `query ($id: Int, $page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage }
        reviews(userId: $id, sort: CREATED_AT_DESC) { mediaId summary body(asHtml: false) score } } }`,
      { id: u.User.id, page },
    );
    reviews.push(...d.Page.reviews);
    if (!d.Page.pageInfo.hasNextPage) break;
  }
  return {
    favourites: { anime: u.User.favourites.anime.nodes.map((n) => n.id), manga: u.User.favourites.manga.nodes.map((n) => n.id) },
    reviews,
  };
}

export async function viewerName(token: string): Promise<string> {
  const data = await gql<{ Viewer: { name: string } }>("query { Viewer { name } }", {}, token);
  return data.Viewer.name;
}

// Reporte l'état d'un média dans la liste AniList du compte connecté.
export async function saveEntry(
  token: string,
  e: { mediaId: number; kind: Kind; status: Status; progress: number; rating: number | null; startedOn: string | null; finishedOn: string | null },
) {
  const query = `mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $progressVolumes: Int, $scoreRaw: Int,
      $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
    SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, progressVolumes: $progressVolumes,
      scoreRaw: $scoreRaw, startedAt: $startedAt, completedAt: $completedAt) { id }
  }`;
  await gql(
    query,
    {
      mediaId: e.mediaId,
      status: STATUS_TO_ANILIST[e.status],
      ...(e.kind === "ln" ? { progressVolumes: e.progress } : { progress: e.progress }),
      // scoreRaw est sur 100 quel que soit le format de notation choisi sur AniList.
      ...(e.rating != null ? { scoreRaw: Math.round(e.rating * 10) } : {}),
      ...(e.startedOn ? { startedAt: isoToFuzzy(e.startedOn) } : {}),
      ...(e.finishedOn ? { completedAt: isoToFuzzy(e.finishedOn) } : {}),
    },
    token,
  );
}
