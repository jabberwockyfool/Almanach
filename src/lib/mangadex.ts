import "server-only";

// MangaDex : lecture des chapitres dans l'appli. Les appels API se font côté serveur (MangaDex demande
// un User-Agent explicite) ; les images sont chargées par le navigateur, sans Referer.

const API = "https://api.mangadex.org";
const UA = "Almanach/0.1 (lecteur personnel)";

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`MangaDex : HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function mangadexIdFromUrl(url: string): string | null {
  return url.match(/mangadex\.org\/title\/([0-9a-f-]{36})/i)?.[1] ?? null;
}

type Localized = Record<string, string>;

export async function searchMangadex(title: string) {
  const data = await api<{
    data: { id: string; attributes: { title: Localized; altTitles: Localized[]; year: number | null } }[];
  }>(`/manga?title=${encodeURIComponent(title)}&limit=8&order[relevance]=desc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`);
  return data.data.map((m) => ({
    id: m.id,
    title: Object.values(m.attributes.title)[0] ?? "?",
    alt: m.attributes.altTitles.map((t) => Object.values(t)[0]).slice(0, 3).join(" · "),
    year: m.attributes.year,
  }));
}

export type Chapter = {
  id: string;
  chapter: string | null;
  volume: string | null;
  title: string | null;
  lang: string;
  group: string;
  pages: number;
};

// Chapitres lisibles sur MangaDex (ceux hébergés ailleurs, avec externalUrl, sont écartés).
export async function chapters(mangaId: string, langs: string[]): Promise<Chapter[]> {
  const out: Chapter[] = [];
  const langQuery = langs.map((l) => `&translatedLanguage[]=${l}`).join("");
  for (let offset = 0; offset < 2000; offset += 500) {
    const data = await api<{
      total: number;
      data: {
        id: string;
        attributes: { chapter: string | null; volume: string | null; title: string | null; translatedLanguage: string; pages: number; externalUrl: string | null };
        relationships: { type: string; attributes?: { name: string } }[];
      }[];
    }>(`/manga/${mangaId}/feed?limit=500&offset=${offset}${langQuery}&order[chapter]=asc&includes[]=scanlation_group&includeExternalUrl=0`);
    for (const c of data.data) {
      if (c.attributes.externalUrl || !c.attributes.pages) continue;
      out.push({
        id: c.id,
        chapter: c.attributes.chapter,
        volume: c.attributes.volume,
        title: c.attributes.title,
        lang: c.attributes.translatedLanguage,
        group: c.relationships.find((r) => r.type === "scanlation_group")?.attributes?.name ?? "",
        pages: c.attributes.pages,
      });
    }
    if (offset + 500 >= data.total) break;
  }
  return out;
}

export async function chapterPages(chapterId: string, dataSaver = false): Promise<string[]> {
  const data = await api<{ baseUrl: string; chapter: { hash: string; data: string[]; dataSaver: string[] } }>(
    `/at-home/server/${chapterId}`,
  );
  const files = dataSaver ? data.chapter.dataSaver : data.chapter.data;
  return files.map((f) => `${data.baseUrl}/${dataSaver ? "data-saver" : "data"}/${data.chapter.hash}/${f}`);
}

export async function chapterInfo(chapterId: string) {
  const data = await api<{ data: { attributes: { chapter: string | null; title: string | null; translatedLanguage: string }; relationships: { type: string; id: string }[] } }>(
    `/chapter/${chapterId}`,
  );
  return {
    chapter: data.data.attributes.chapter,
    title: data.data.attributes.title,
    lang: data.data.attributes.translatedLanguage,
    mangaId: data.data.relationships.find((r) => r.type === "manga")?.id ?? null,
  };
}
