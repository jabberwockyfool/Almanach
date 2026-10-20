import "server-only";
import { cache } from "react";
import { getSetting } from "@/lib/db";
import { currentUser } from "@/lib/user";

// Couvertures des anime dans les grilles : celle de MyAnimeList (cover_grid, souvent avec le logo) ou celle
// d'AniList (cover). Réglage du compte qui regarde, appliqué aussi aux bibliothèques des autres.
export type CoverSource = "mal" | "anilist";

export const coverSource = cache(async (): Promise<CoverSource> => {
  const me = await currentUser();
  return me && (await getSetting(me.id, "cover_source")) === "anilist" ? "anilist" : "mal";
});

export async function withCovers<T extends { cover_grid: string }>(rows: T[]): Promise<T[]> {
  if ((await coverSource()) === "mal") return rows;
  return rows.map((r) => (r.cover_grid ? { ...r, cover_grid: "" } : r));
}
