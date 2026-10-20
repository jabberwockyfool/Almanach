import "server-only";
import { getSetting } from "@/lib/db";
import type { Chapter } from "@/lib/mangadex";

// Langues de lecture MangaDex, par ordre de préférence (Réglages).
export async function readingLangs(uid: number): Promise<string[]> {
  const raw = await getSetting(uid, "mangadex_langs");
  const langs = (raw || "fr,en").split(/[\s,]+/).filter(Boolean);
  return langs.length ? langs : ["fr", "en"];
}

// Un chapitre par numéro : la première langue de la liste l'emporte, puis le premier groupe trouvé.
export function uniqueChapters(list: Chapter[], langs: string[]): Chapter[] {
  const best = new Map<string, Chapter>();
  for (const c of list) {
    const key = c.chapter ?? c.id;
    const cur = best.get(key);
    if (!cur || langs.indexOf(c.lang) < langs.indexOf(cur.lang)) best.set(key, c);
  }
  return [...best.values()].sort((a, b) => Number(a.chapter ?? 0) - Number(b.chapter ?? 0));
}
