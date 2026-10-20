import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { readCompanion } from "@/lib/auth";
import { getSetting } from "@/lib/db";
import {
  importBackloggd, importBackloggdLists, importBackloggdReviews, markBackloggdDone, pendingBackloggd, syncBackloggdReviews,
  syncVnAliases, type BackloggdEntry, type BackloggdListEntry, type BackloggdReview,
} from "@/lib/sync";

// API du compagnon Backloggd (scripts/backloggd.mjs), authentifiée par le jeton du compte affiché dans Réglages.
// GET  → pseudo Backloggd + fins à écrire dans le journal.
// POST → { entries } : journal lu ; { lists } : jeux des listes Backlog / Playing / aimés / favoris ;
//        { reviews } : critiques du profil (dates de fin des jeux sans journal) ;
//        { done } : fins écrites (avec le slug trouvé si le jeu n'en avait pas).

export async function GET(request: NextRequest) {
  const uid = await readCompanion(request.headers.get("authorization"));
  if (!uid) return new Response("Jeton invalide", { status: 401 });
  return Response.json({ user: await getSetting(uid, "backloggd_user"), pending: await pendingBackloggd(uid) });
}

export async function POST(request: NextRequest) {
  const uid = await readCompanion(request.headers.get("authorization"));
  if (!uid) return new Response("Jeton invalide", { status: 401 });
  const body = (await request.json()) as {
    entries?: BackloggdEntry[];
    lists?: BackloggdListEntry[];
    reviews?: BackloggdReview[];
    done?: { log_id: number; slug?: string }[];
  };
  let report = null;
  if (Array.isArray(body.lists)) report = await importBackloggdLists(uid, body.lists);
  if (Array.isArray(body.entries)) report = await importBackloggd(uid, body.entries);
  if (Array.isArray(body.reviews)) report = await importBackloggdReviews(uid, body.reviews);
  if (Array.isArray(body.done)) await markBackloggdDone(uid, body.done);
  // Nouveaux jeux vus : leurs titres VNDB (adaptations de VN) et les critiques récentes du profil.
  if (Array.isArray(body.entries)) {
    await syncVnAliases(uid).catch(() => {});
    await syncBackloggdReviews(uid).catch(() => {});
  }
  revalidatePath("/", "layout");
  return Response.json({ ok: true, report });
}
