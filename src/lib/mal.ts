import "server-only";
import { all, batch, run, type Stmt } from "@/lib/db";

// Couvertures MyAnimeList pour la grille des anime (elles portent souvent le logo de la série) ; la fiche garde
// celle d'AniList. AniList donne l'identifiant MAL ; la couverture se lit sur la page de l'anime (og:image).
// MAL limite le débit : une page par seconde environ, par lots, la suite à la synchro suivante.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

async function malIds(anilistIds: number[]): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  for (let i = 0; i < anilistIds.length; i += 50) {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: "query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids) { id idMal } } }",
        variables: { ids: anilistIds.slice(i, i + 50) },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json()) as { data?: { Page: { media: { id: number; idMal: number | null }[] } } };
    for (const m of data.data?.Page.media ?? []) out.set(m.id, m.idMal);
  }
  return out;
}

async function malCover(malId: number): Promise<string | null> {
  const res = await fetch(`https://myanimelist.net/anime/${malId}`, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (res.status === 429 || res.status === 403) throw new Error("MAL limite les requêtes, réessaie dans une minute.");
  if (!res.ok) return null;
  const html = await res.text();
  const img = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  // Version grande taille (suffixe « l ») quand elle existe dans l'URL.
  return img ? img.replace(/(\/\d+)\.(jpe?g|webp)$/, "$1l.$2") : null;
}

export async function syncMalCovers(uid: number, budgetMs = 15000): Promise<{ done: number; left: number }> {
  const pending = await all<{ id: number; anilist_id: number; mal_id: number | null }>(
    "SELECT id, anilist_id, mal_id FROM media WHERE user_id = ? AND kind = 'anime' AND anilist_id IS NOT NULL AND mal_at IS NULL ORDER BY updated_at DESC",
    [uid],
  );
  if (!pending.length) return { done: 0, left: 0 };
  const missing = pending.filter((p) => p.mal_id == null).map((p) => p.anilist_id);
  const ids = missing.length ? await malIds(missing) : new Map<number, number | null>();
  const start = Date.now();
  let done = 0;
  for (const p of pending) {
    if (Date.now() - start > budgetMs) break;
    const malId = p.mal_id ?? ids.get(p.anilist_id) ?? null;
    const stmts: Stmt[] = [];
    if (!malId) {
      stmts.push({ sql: "UPDATE media SET mal_at = datetime('now') WHERE id = ?", args: [p.id] });
    } else {
      const cover = await malCover(malId);
      stmts.push({
        sql: "UPDATE media SET mal_id = ?, cover_grid = COALESCE(?, cover_grid), mal_at = datetime('now') WHERE id = ?",
        args: [malId, cover, p.id],
      });
      await new Promise((r) => setTimeout(r, 250));
    }
    await batch(stmts);
    done++;
  }
  return { done, left: pending.length - done };
}

// Revenir à la couverture AniList dans la grille (si celle de MAL ne plaît pas pour une fiche).
export async function clearGridCover(uid: number, mediaId: number) {
  await run("UPDATE media SET cover_grid = '' WHERE id = ? AND user_id = ?", [mediaId, uid]);
}
