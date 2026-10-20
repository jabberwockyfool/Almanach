"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addActivity, addLog, all, batch, deleteMedia, findMedia, get, getMedia, run, setSetting, upsertMedia, type Media, type MediaInput,
} from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth";
import { requireAdmin, requireUid } from "@/lib/user";
import { FAV_MAX, isKind, isRelation, isStatus, today, youtubeId, type Kind, type Status } from "@/lib/kinds";
import { coverCandidates, searchCatalog, tvmazeEpisodeCount, type SearchResult } from "@/lib/catalog";
import { viewerName } from "@/lib/anilist";
import { parseDiaryCsv } from "@/lib/letterboxd";
import { mangadexIdFromUrl, searchMangadex } from "@/lib/mangadex";
import { addEvents, recordFinish, recordProgress, recordRating, recordStatus } from "@/lib/events";
import { sgdbCovers } from "@/lib/info";
import { syncSteam } from "@/lib/steam";
import { syncMalCovers } from "@/lib/mal";
import {
  completeFilmPosters, importFilms, pushAniList, pushPendingAniList, syncAniList, syncBackloggdReviews, syncLetterboxd, syncRelations,
} from "@/lib/sync";

// Résultat affiché sous le bouton qui a lancé l'action.
export type Feedback = { ok: boolean; text: string };

function done(text: string): Feedback {
  revalidatePath("/", "layout");
  return { ok: true, text };
}

function failed(err: unknown): Feedback {
  return { ok: false, text: err instanceof Error ? err.message : String(err) };
}

// Fiche du compte connecté (erreur si elle appartient à un autre compte).
async function own(id: number): Promise<Media> {
  const m = await getMedia(await requireUid(), id);
  if (!m) throw new Error("Fiche introuvable");
  return m;
}

async function ownLog(logId: number): Promise<{ media_id: number }> {
  const uid = await requireUid();
  const log = await get<{ media_id: number }>("SELECT log.media_id FROM log JOIN media ON media.id = log.media_id WHERE log.id = ? AND media.user_id = ?", [
    logId,
    uid,
  ]);
  if (!log) throw new Error("Fin introuvable");
  return log;
}

function isoDate(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// Date de fin envoyée par <DateFields> : « when » au format AAAA-MM-JJ, AAAA-MM ou AAAA, ou précision « inconnue ».
function parseWhen(form: FormData): { day: string | null; unknown: boolean } | null {
  if (String(form.get("precision")) === "inconnue") return { day: null, unknown: true };
  const when = String(form.get("when") ?? "").trim();
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(when)) return { day: when, unknown: false };
  return null;
}

function rating10(v: number | null): number | null {
  return v == null ? null : Math.min(10, Math.max(0, Math.round(v * 2) / 2));
}

function num(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------------------------
// Session et comptes

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/connexion");
}

export async function setUserStatus(userId: number, status: "member" | "admin"): Promise<Feedback> {
  try {
    await requireAdmin();
    await run("UPDATE users SET status = ? WHERE id = ?", [status, userId]);
    return done(status === "admin" ? "Admin" : "Accès accordé");
  } catch (err) {
    return failed(err);
  }
}

// Retire un compte et toutes ses données (pas le sien).
export async function removeUser(userId: number): Promise<Feedback> {
  try {
    const admin = await requireAdmin();
    if (admin.id === userId) return { ok: false, text: "Impossible de retirer ton propre compte." };
    const ids = (await all<{ id: number }>("SELECT id FROM media WHERE user_id = ?", [userId])).map((r) => r.id);
    for (const id of ids) await deleteMedia(userId, id);
    await run("DELETE FROM event WHERE user_id = ?", [userId]);
    await run("DELETE FROM user_setting WHERE user_id = ?", [userId]);
    await run("DELETE FROM steam_game WHERE user_id = ?", [userId]);
    await run("DELETE FROM users WHERE id = ?", [userId]);
    return done("Compte retiré");
  } catch (err) {
    return failed(err);
  }
}

// ---------------------------------------------------------------------------------------------
// Ajout

// Résultats de recherche ; « owned » = id de la fiche si l'œuvre est déjà dans la bibliothèque.
export async function search(kind: Kind, q: string): Promise<{ results: (SearchResult & { owned?: number })[]; error?: string }> {
  try {
    const uid = await requireUid();
    const results = await searchCatalog(kind, q);
    return { results: await Promise.all(results.map(async (r) => ({ ...r, owned: (await findMedia(uid, r))?.id }))) };
  } catch (err) {
    return { results: [], error: failed(err).text };
  }
}

// Menu d'ajout (façon AniList) : la fiche (résultat de recherche, ou saisie à la main si result est null) et
// son suivi d'un coup — statut, progression, note, dates, notes, « j'aime », œuvre d'origine.
// Terminé aujourd'hui = fin « à l'instant », publiée dans le fil ; une date passée l'ajoute sans la publier.
export async function addEntry(result: SearchResult | null, form: FormData): Promise<Feedback & { id?: number; title?: string }> {
  try {
    const uid = await requireUid();
    let input: MediaInput;
    if (result) {
      if (!isKind(result.kind) || !result.title) throw new Error("Fiche invalide");
      input = { ...result };
      delete (input as { source?: string }).source;
      delete (input as { owned?: number }).owned;
    } else {
      const kind = String(form.get("kind"));
      const title = String(form.get("title") ?? "").trim();
      if (!isKind(kind) || !title) return { ok: false, text: "Il faut au moins un titre." };
      input = {
        kind,
        title,
        year: num(form.get("year")),
        cover: String(form.get("cover") ?? "").trim(),
        author: String(form.get("author") ?? "").trim(),
        isbn: String(form.get("isbn") ?? "").replace(/[\s-]/g, "") || null,
      };
    }
    const total = num(form.get("total"));
    if (total != null && total > 0) input.total = Math.round(total);
    if (input.kind === "serie" && input.tvmaze_id && !input.total) input.total = await tvmazeEpisodeCount(input.tvmaze_id);
    if (await findMedia(uid, input)) return { ok: false, text: "Déjà dans ta bibliothèque." };
    const m = await upsertMedia(uid, input);

    const status = String(form.get("status"));
    const st: Status = isStatus(status) ? status : "prevu";
    const rating = rating10(num(form.get("rating")));
    const progress = st === "termine" && m.total ? m.total : Math.max(0, Math.round(num(form.get("progress")) ?? 0));
    const parent = num(form.get("parent"));
    if (parent) await own(parent);
    const relation = parent && isRelation(form.get("relation")) ? String(form.get("relation")) : null;
    await run(
      `UPDATE media SET status = ?, progress = ?, rating = ?, started_on = ?, notes = ?, liked = ?, parent_override = ?, parent_relation = ?,
       private = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        st, progress, rating, isoDate(form.get("started_on")), String(form.get("notes") ?? "").trim(), form.get("liked") ? 1 : 0, parent || null,
        relation, form.get("private") ? 1 : 0, m.id,
      ],
    );
    const after = (await own(m.id))!;

    if (st === "termine") {
      const when = parseWhen(form) ?? { day: today(), unknown: false };
      const instant = when.day === today();
      const logId = await addLog(m.id, when.day, { rating, unknown: when.unknown, backloggdPending: m.kind === "jeu" && instant });
      if (logId && instant) await recordFinish(after, false, rating, today());
    } else if (st === "en_cours" && progress > 0) {
      await addActivity(m.id, today(), progress);
      await recordProgress(after, 0, progress);
    } else {
      await recordStatus(after, null, st);
    }
    if (m.anilist_id) await syncRelations([m.anilist_id]).catch(() => {});
    const err = await pushAniList(after);
    return { ...done(err ? `Ajouté, mais AniList a refusé : ${err}` : "Ajouté"), id: m.id, title: m.title };
  } catch (err) {
    return failed(err);
  }
}

// ---------------------------------------------------------------------------------------------
// Suivi

export async function updateMedia(id: number, form: FormData): Promise<Feedback> {
  try {
    const before = await own(id);
    const status = String(form.get("status"));
    const rating = num(form.get("rating"));
    await run(
      `UPDATE media SET title = ?, subtitle = ?, year = ?, cover = ?, status = ?, progress = ?, total = ?, rating = ?,
       started_on = ?, notes = ?, author = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        String(form.get("title") ?? before.title).trim() || before.title,
        String(form.get("subtitle") ?? "").trim(),
        num(form.get("year")),
        String(form.get("cover") ?? "").trim(),
        isStatus(status) ? status : before.status,
        Math.max(0, Math.round(num(form.get("progress")) ?? 0)),
        num(form.get("total")),
        rating == null ? null : Math.min(10, Math.max(0, rating)),
        isoDate(form.get("started_on")),
        String(form.get("notes") ?? ""),
        String(form.get("author") ?? before.author ?? "").trim(),
        id,
      ],
    );
    const after = await own(id);
    if (before.status !== after.status && after.status !== "termine") await recordStatus(after, before.status, after.status);
    // Passé à « Terminé » à la main : la fin est datée d'aujourd'hui (modifiable ensuite dans l'historique).
    if (before.status !== "termine" && after.status === "termine") {
      await addLog(id, today(), { rating: after.rating, backloggdPending: after.kind === "jeu" });
      await recordFinish(after, false, after.rating, today());
    }
    const err = await pushAniList(after);
    return done(err ? `Enregistré, mais AniList a refusé : ${err}` : "Enregistré");
  } catch (err) {
    return failed(err);
  }
}

export async function finishMedia(id: number, form: FormData): Promise<Feedback> {
  try {
    const m = await own(id);
    // « Fini à l'instant » : daté d'aujourd'hui et publié dans le fil. « Ajouter à la bibliothèque » : date
    // approximative choisie (jour, mois, année ou inconnue), sans apparaître dans le fil.
    const instant = String(form.get("mode") ?? "instant") !== "bibliotheque";
    const when = instant ? { day: today(), unknown: false } : (parseWhen(form) ?? { day: null, unknown: true });
    const rating = rating10(num(form.get("rating"))) ?? m.rating;
    const rewatch = m.status === "termine";
    const logId = await addLog(id, when.day, {
      rating,
      rewatch,
      unknown: when.unknown,
      // Backloggd : seulement une fin du jour même (le journal veut une date précise et récente).
      backloggdPending: m.kind === "jeu" && instant,
    });
    if (logId && instant) await recordFinish(m, rewatch, rating, today());
    await run("UPDATE media SET status = 'termine', progress = COALESCE(total, progress), rating = ?, updated_at = datetime('now') WHERE id = ?", [
      rating,
      id,
    ]);
    const err = await pushAniList(await own(id));
    if (!logId) return done("Déjà terminé à cette date");
    return done(err ? `Ajouté, mais AniList a refusé : ${err}` : instant ? "Terminé" : "Ajouté à la bibliothèque");
  } catch (err) {
    return failed(err);
  }
}

// +1 épisode / chapitre / volume. Atteindre le total termine le média.
export async function stepProgress(id: number, delta = 1): Promise<Feedback> {
  try {
    const m = await own(id);
    const progress = Math.max(0, m.progress + delta);
    const finished = m.total != null && progress >= m.total && delta > 0;
    const status = finished ? "termine" : m.status === "prevu" || m.status === "pause" ? "en_cours" : m.status;
    await run(
      "UPDATE media SET progress = ?, status = ?, started_on = COALESCE(started_on, ?), updated_at = datetime('now') WHERE id = ?",
      [progress, status, today(), id],
    );
    if (delta > 0) {
      await addActivity(id, today(), delta);
      await recordProgress(m, m.progress, progress);
    }
    if (finished && m.status !== "termine") {
      await addLog(id, today(), { rating: m.rating });
      await recordFinish(m, false, m.rating, today());
    }
    const err = await pushAniList(await own(id));
    return done(err ? `AniList a refusé : ${err}` : finished ? "Terminé !" : `${progress}${m.total ? ` / ${m.total}` : ""}`);
  } catch (err) {
    return failed(err);
  }
}

// Menu de suivi d'une fiche de sa bibliothèque (bouton de statut sous la couverture) : statut, note, progression,
// dates, notes, « j'aime », privé. Mêmes effets que le reste de l'appli : fin datée (publiée si c'est aujourd'hui),
// épisodes avancés dans le fil, changement de statut, envoi à AniList.
export async function saveEntry(id: number, form: FormData): Promise<Feedback> {
  try {
    const before = await own(id);
    const status = String(form.get("status"));
    const st: Status = isStatus(status) ? status : before.status;
    const total = num(form.get("total"));
    const newTotal = total != null && total > 0 ? Math.round(total) : before.total;
    const rating = rating10(num(form.get("rating")));
    const asked = num(form.get("progress"));
    const progress = st === "termine" && newTotal ? newTotal : asked == null ? before.progress : Math.max(0, Math.round(asked));
    await run(
      `UPDATE media SET status = ?, progress = ?, total = ?, rating = ?, started_on = ?, notes = ?, liked = ?, private = ?,
       updated_at = datetime('now') WHERE id = ?`,
      [
        st, progress, newTotal, rating, isoDate(form.get("started_on")), String(form.get("notes") ?? "").trim(), form.get("liked") ? 1 : 0,
        form.get("private") ? 1 : 0, id,
      ],
    );
    const after = await own(id);
    if (st === "termine" && before.status !== "termine") {
      const when = parseWhen(form) ?? { day: today(), unknown: false };
      const instant = when.day === today();
      const logId = await addLog(id, when.day, { rating, unknown: when.unknown, backloggdPending: after.kind === "jeu" && instant });
      if (logId && instant) await recordFinish(after, false, rating, today());
    } else if (st !== before.status) {
      await recordStatus(after, before.status, st);
    }
    if (st !== "termine" && progress > before.progress) {
      await addActivity(id, today(), progress - before.progress);
      await recordProgress(after, before.progress, progress);
    }
    if (rating != null && rating !== before.rating && !(st === "termine" && before.status !== "termine")) await recordRating(after, rating);
    const err = await pushAniList(after);
    return done(err ? `Enregistré, mais AniList a refusé : ${err}` : "Enregistré");
  } catch (err) {
    return failed(err);
  }
}

// Progression saisie directement (« page 120 »), mêmes effets que les +1.
export async function setProgress(id: number, form: FormData): Promise<Feedback> {
  try {
    const m = await own(id);
    const value = num(form.get("progress"));
    if (value == null || value < 0) return { ok: false, text: "Nombre invalide" };
    return stepProgress(id, Math.round(value) - m.progress);
  } catch (err) {
    return failed(err);
  }
}

export async function setLogDate(logId: number, form: FormData): Promise<Feedback> {
  return bulkLogDate([logId], form);
}

// Corrige la date de plusieurs fins d'un coup (jour, mois, année seule ou inconnue). La date d'origine de la
// source reste dans source_day : une resynchro ne recrée pas la fin à l'ancienne date.
export async function bulkLogDate(logIds: number[], form: FormData): Promise<Feedback> {
  try {
    const uid = await requireUid();
    const when = parseWhen(form);
    if (!when) return { ok: false, text: "Date invalide" };
    // Seulement les fins du compte connecté.
    const mine = (
      await all<{ id: number }>(
        `SELECT log.id FROM log JOIN media ON media.id = log.media_id WHERE media.user_id = ? AND log.id IN (${logIds.map(() => "?").join(",") || "NULL"})`,
        [uid, ...logIds],
      )
    ).map((r) => r.id);
    if (!mine.length) return { ok: false, text: "Rien de sélectionné" };
    const marks = mine.map(() => "?").join(",");
    await run(
      `UPDATE log SET finished_on = ?, unknown = ?,
         backloggd_pending = CASE WHEN length(?) = 10 THEN backloggd_pending ELSE 0 END
       WHERE id IN (${marks})`,
      [when.day, when.unknown ? 1 : 0, when.day ?? "", ...mine],
    );
    // Les fiches AniList concernées renverront leur date de fin.
    await run(`UPDATE media SET anilist_dirty = 1 WHERE anilist_id IS NOT NULL AND id IN (SELECT media_id FROM log WHERE id IN (${marks}))`, mine);
    const r = await pushPendingAniList(uid, 10000);
    const n = mine.length;
    return done(`${n > 1 ? `${n} dates modifiées` : "Date modifiée"}${r.left ? ` · ${r.left} en attente d’envoi sur AniList` : ""}`);
  } catch (err) {
    return failed(err);
  }
}

export async function deleteLog(logId: number): Promise<Feedback> {
  try {
    await ownLog(logId);
    await run("DELETE FROM log WHERE id = ?", [logId]);
    return done("Fin supprimée");
  } catch (err) {
    return failed(err);
  }
}

export async function removeMedia(id: number) {
  await deleteMedia(await requireUid(), id);
  revalidatePath("/", "layout");
  redirect("/bibliotheque");
}

// Note de la fiche. La dernière fin prend la même note (c'est elle que le récap affiche).
export async function setRating(mediaId: number, value: number | null): Promise<Feedback> {
  try {
    const rating = rating10(value);
    await own(mediaId);
    await run("UPDATE media SET rating = ?, updated_at = datetime('now') WHERE id = ?", [rating, mediaId]);
    await recordRating(await own(mediaId), rating);
    await run(
      `UPDATE log SET rating = ? WHERE id = (SELECT id FROM log WHERE media_id = ? ORDER BY finished_on IS NULL, finished_on DESC, id DESC LIMIT 1)`,
      [rating, mediaId],
    );
    const err = await pushAniList(await own(mediaId));
    return done(err ? `AniList a refusé : ${err}` : "");
  } catch (err) {
    return failed(err);
  }
}

// Note d'une fin précise (un revisionnage peut avoir la sienne). Si c'est la dernière, la fiche suit.
export async function setLogRating(logId: number, value: number | null): Promise<Feedback> {
  try {
    const rating = rating10(value);
    const log = await ownLog(logId);
    await run("UPDATE log SET rating = ? WHERE id = ?", [rating, logId]);
    const last = await get<{ id: number }>("SELECT id FROM log WHERE media_id = ? ORDER BY finished_on IS NULL, finished_on DESC, id DESC LIMIT 1", [
      log.media_id,
    ]);
    if (last?.id === logId) {
      await run("UPDATE media SET rating = ? WHERE id = ?", [rating, log.media_id]);
      const err = await pushAniList(await own(log.media_id));
      if (err) return done(`AniList a refusé : ${err}`);
    }
    return done("");
  } catch (err) {
    return failed(err);
  }
}

// « J'aime » (cœur dans la grille).
export async function toggleLike(mediaId: number): Promise<Feedback> {
  try {
    const m = await own(mediaId);
    await run("UPDATE media SET liked = ? WHERE id = ?", [m.liked ? 0 : 1, mediaId]);
    return done(m.liked ? "" : "Aimé");
  } catch (err) {
    return failed(err);
  }
}

export async function setReview(mediaId: number, form: FormData): Promise<Feedback> {
  try {
    await own(mediaId);
    await run("UPDATE media SET review = ?, updated_at = datetime('now') WHERE id = ?", [String(form.get("review") ?? "").trim(), mediaId]);
    return done("Critique enregistrée");
  } catch (err) {
    return failed(err);
  }
}

// Favoris du profil : une liste commune à tous les types (FAV_MAX au plus), le premier porte la couronne.
// Une fois modifiée dans l'appli, les imports (AniList, Backloggd) n'y touchent plus.
async function writeFavorites(uid: number, ids: number[]) {
  await batch([
    { sql: "UPDATE media SET fav_rank = NULL WHERE user_id = ? AND fav_rank IS NOT NULL", args: [uid] },
    ...ids.slice(0, FAV_MAX).map((id, i) => ({ sql: "UPDATE media SET fav_rank = ? WHERE id = ? AND user_id = ?", args: [i + 1, id, uid] })),
  ]);
  await setSetting(uid, "favs_edited", new Date().toISOString());
}

export async function setFavorite(mediaId: number, action: "add" | "remove" | "crown"): Promise<Feedback> {
  try {
    const m = await own(mediaId);
    const favs = await all<{ id: number }>("SELECT id FROM media WHERE user_id = ? AND fav_rank IS NOT NULL AND id <> ? ORDER BY fav_rank", [
      m.user_id,
      m.id,
    ]);
    let order = favs.map((f) => f.id);
    if (action === "add") {
      if (order.length >= FAV_MAX) return { ok: false, text: `${FAV_MAX} favoris au plus : retires-en un d’abord (Réglages).` };
      order.push(m.id);
    } else if (action === "crown") order = [m.id, ...order];
    await writeFavorites(m.user_id, order);
    return done(action === "remove" ? "Retiré des favoris" : action === "crown" ? "Couronné" : "Ajouté aux favoris");
  } catch (err) {
    return failed(err);
  }
}

// Liste complète des favoris dans l'ordre voulu (éditeur des Réglages : glisser, ajouter, retirer).
export async function saveFavorites(ids: number[]): Promise<Feedback> {
  try {
    const uid = await requireUid();
    const clean = [...new Set(ids.map(Number).filter(Number.isInteger))];
    if (clean.length > FAV_MAX) return { ok: false, text: `${FAV_MAX} favoris au plus.` };
    const owned = clean.length
      ? await all<{ id: number }>(`SELECT id FROM media WHERE user_id = ? AND id IN (${clean.map(() => "?").join(",")})`, [uid, ...clean])
      : [];
    if (owned.length !== clean.length) return { ok: false, text: "Fiche introuvable" };
    await writeFavorites(uid, clean);
    return done("");
  } catch (err) {
    return failed(err);
  }
}

// Rattachement manuel : null = automatique, 0 = afficher seul, sinon id de la fiche parente (du même compte).
// relation : « Remake », « Adaptation »… (null = déduite des formats), gardée seulement avec un parent.
export async function setParent(mediaId: number, parentId: number | null, relation: string | null = null): Promise<Feedback> {
  try {
    const m = await own(mediaId);
    if (parentId) await own(parentId);
    if (parentId === m.id) return { ok: false, text: "Une fiche ne peut pas être son propre parent." };
    const rel = parentId && isRelation(relation) ? relation : null;
    await run("UPDATE media SET parent_override = ?, parent_relation = ? WHERE id = ?", [parentId, rel, mediaId]);
    return done(parentId === null ? "Rangement automatique" : parentId === 0 ? "Affiché seul" : rel ? `Relié : ${rel}` : "Rattaché");
  } catch (err) {
    return failed(err);
  }
}

// Change seulement la relation au parent actuel (trouvé automatiquement ou choisi à la main).
export async function setRelation(mediaId: number, relation: string | null): Promise<Feedback> {
  try {
    await own(mediaId);
    await run("UPDATE media SET parent_relation = ? WHERE id = ?", [isRelation(relation) ? relation : null, mediaId]);
    return done(isRelation(relation) ? `Relation : ${relation}` : "Relation déduite");
  } catch (err) {
    return failed(err);
  }
}

// Fiche privée (comme sur AniList) : cachée des autres comptes, et ses activités retirées de leur fil.
export async function setPrivate(mediaId: number, value: boolean): Promise<Feedback> {
  try {
    await own(mediaId);
    await run("UPDATE media SET private = ? WHERE id = ?", [value ? 1 : 0, mediaId]);
    return done(value ? "Privée : visible de toi seul" : "Visible du groupe");
  } catch (err) {
    return failed(err);
  }
}

// Retire une activité de son fil (gardée en base, masquée, pour qu'une resynchro ne la recrée pas).
export async function hideEvent(eventId: number): Promise<Feedback> {
  try {
    const uid = await requireUid();
    const { changes } = await run("UPDATE event SET hidden = 1 WHERE id = ? AND user_id = ?", [eventId, uid]);
    if (!changes) return { ok: false, text: "Activité introuvable" };
    return { ok: true, text: "" };
  } catch (err) {
    return failed(err);
  }
}

// Autres titres ajoutés à la main (« C;C », « カオチャ »…), cherchables dans la bibliothèque.
export async function addAlias(mediaId: number, form: FormData): Promise<Feedback> {
  try {
    await own(mediaId);
    const titles = String(form.get("alias") ?? "").split(/\n|\s*;\s*/).map((s) => s.trim()).filter(Boolean);
    if (!titles.length) return { ok: false, text: "Titre vide" };
    for (const title of titles) await run("INSERT OR IGNORE INTO title_alias (media_id, title) VALUES (?, ?)", [mediaId, title]);
    return done(titles.length > 1 ? `${titles.length} titres ajoutés` : "Titre ajouté");
  } catch (err) {
    return failed(err);
  }
}

export async function removeAlias(mediaId: number, title: string): Promise<Feedback> {
  try {
    await own(mediaId);
    await run("DELETE FROM title_alias WHERE media_id = ? AND title = ?", [mediaId, title]);
    return done("");
  } catch (err) {
    return failed(err);
  }
}

// Opening / ending ajouté à la main par un lien YouTube (jeux, VN, ou ce qu'animethemes n'a pas).
export async function addTheme(mediaId: number, form: FormData): Promise<Feedback> {
  try {
    await own(mediaId);
    const url = String(form.get("url") ?? "").trim();
    if (!youtubeId(url)) return { ok: false, text: "Il faut un lien YouTube (youtube.com/watch?v=… ou youtu.be/…)." };
    const type = ["OP", "ED", "IN"].includes(String(form.get("type"))) ? String(form.get("type")) : "OP";
    await run("INSERT INTO theme (media_id, type, title, url) VALUES (?, ?, ?, ?)", [mediaId, type, String(form.get("title") ?? "").trim(), url]);
    return done("Ajouté");
  } catch (err) {
    return failed(err);
  }
}

export async function removeTheme(themeId: number): Promise<Feedback> {
  try {
    const uid = await requireUid();
    await run("DELETE FROM theme WHERE id = ? AND media_id IN (SELECT id FROM media WHERE user_id = ?)", [themeId, uid]);
    return done("");
  } catch (err) {
    return failed(err);
  }
}

// Recherche dans sa propre bibliothèque (choix d'un parent).
export async function searchOwn(q: string): Promise<{ id: number; title: string; kind: Kind; year: number | null; cover: string }[]> {
  const uid = await requireUid();
  if (!q.trim()) return [];
  const like = `%${q.trim()}%`;
  return all(
    `SELECT id, title, kind, year, cover FROM media WHERE user_id = ? AND (title LIKE ? OR subtitle LIKE ?
       OR id IN (SELECT media_id FROM title_alias WHERE title LIKE ?) OR id IN (SELECT media_id FROM alias WHERE title LIKE ?))
     ORDER BY status = 'prevu', title LIMIT 12`,
    [uid, like, like, like, like],
  );
}

// Couverture : adresse d'image, ou image envoyée (réduite dans le navigateur, gardée en data: URL).
export async function setCover(mediaId: number, cover: string): Promise<Feedback> {
  try {
    await own(mediaId);
    cover = cover.trim();
    const ok = cover === "" || /^https?:\/\//i.test(cover) || /^data:image\/(jpeg|png|webp);base64,/.test(cover);
    if (!ok) return { ok: false, text: "Adresse d’image invalide" };
    if (cover.length > 600_000) return { ok: false, text: "Image trop lourde" };
    // Une couverture choisie à la main vaut aussi pour la grille.
    await run("UPDATE media SET cover = ?, cover_grid = '', updated_at = datetime('now') WHERE id = ?", [cover, mediaId]);
    return done("Couverture changée");
  } catch (err) {
    return failed(err);
  }
}

export async function findCovers(mediaId: number): Promise<{ covers: string[]; error?: string }> {
  try {
    const m = await own(mediaId);
    const [base, grids] = await Promise.all([coverCandidates(m), m.kind === "jeu" ? sgdbCovers(m).catch(() => []) : []]);
    return { covers: [...new Set([...grids, ...base])] };
  } catch (err) {
    return { covers: [], error: failed(err).text };
  }
}

// Changement de statut en masse (Bibliothèque). Passer à « Terminé » ajoute une fin datée d'aujourd'hui ou
// de date inconnue. Les fiches AniList partent dans la limite de temps, le reste attend (Réglages).
export async function bulkStatus(ids: number[], status: Status, finish: "today" | "unknown" = "unknown"): Promise<Feedback> {
  try {
    const uid = await requireUid();
    if (!isStatus(status) || !ids.length) return { ok: false, text: "Rien à changer" };
    const rows = await all<Media>(`SELECT * FROM media WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`, [uid, ...ids]);
    let changed = 0;
    for (const m of rows) {
      if (m.status === status) continue;
      changed++;
      await run(
        `UPDATE media SET status = ?, anilist_dirty = CASE WHEN anilist_id IS NULL THEN 0 ELSE 1 END,
           progress = CASE WHEN ? = 'termine' THEN COALESCE(total, progress) ELSE progress END,
           updated_at = datetime('now') WHERE id = ?`,
        [status, status, m.id],
      );
      if (status === "termine") {
        await addLog(m.id, finish === "today" ? today() : null, {
          rating: m.rating,
          unknown: finish === "unknown",
          backloggdPending: m.kind === "jeu" && finish === "today",
        });
      }
    }
    const r = await pushPendingAniList(uid, 15000);
    const tail = r.error ? ` · AniList : ${r.error}` : r.left ? ` · ${r.left} en attente d’envoi sur AniList (Réglages)` : "";
    return done(`${changed} fiche${changed > 1 ? "s" : ""} modifiée${changed > 1 ? "s" : ""}${tail}`);
  } catch (err) {
    return failed(err);
  }
}

export async function bulkDelete(ids: number[]): Promise<Feedback> {
  const uid = await requireUid();
  for (const id of ids) await deleteMedia(uid, id);
  return done(`${ids.length} supprimé${ids.length > 1 ? "s" : ""}`);
}

export async function runAniListPending(): Promise<Feedback> {
  const r = await pushPendingAniList(await requireUid(), 25000);
  if (r.error) return { ok: false, text: `${r.sent} envoyés, puis AniList a refusé : ${r.error}` };
  return done(r.left ? `${r.sent} envoyés · encore ${r.left} (relance dans une minute)` : `${r.sent} envoyés, tout est à jour`);
}

// ---------------------------------------------------------------------------------------------
// Liens « où regarder / lire »

export async function addLink(mediaId: number, form: FormData): Promise<Feedback> {
  try {
    await own(mediaId);
    let url = String(form.get("url") ?? "").trim();
    if (!url) return { ok: false, text: "Adresse vide" };
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    let label = String(form.get("label") ?? "").trim();
    if (!label) label = new URL(url).hostname.replace(/^www\./, "");
    await run("INSERT INTO link (media_id, label, url, position) VALUES (?, ?, ?, (SELECT COUNT(*) FROM link WHERE media_id = ?))", [
      mediaId,
      label,
      url,
      mediaId,
    ]);
    // Un lien MangaDex active le lecteur intégré.
    const md = mangadexIdFromUrl(url);
    if (md) await run("UPDATE media SET mangadex_id = ? WHERE id = ?", [md, mediaId]);
    return done("Lien ajouté");
  } catch (err) {
    return failed(err);
  }
}

export async function deleteLink(linkId: number): Promise<Feedback> {
  const uid = await requireUid();
  await run("DELETE FROM link WHERE id = ? AND media_id IN (SELECT id FROM media WHERE user_id = ?)", [linkId, uid]);
  return done("Lien supprimé");
}

export async function findMangadex(title: string) {
  try {
    await requireUid();
    return { results: await searchMangadex(title) };
  } catch (err) {
    return { results: [], error: failed(err).text };
  }
}

export async function setMangadex(mediaId: number, mangadexId: string | null): Promise<Feedback> {
  try {
    await own(mediaId);
    await run("UPDATE media SET mangadex_id = ? WHERE id = ?", [mangadexId, mediaId]);
    return done(mangadexId ? "Lecteur MangaDex relié" : "Lecteur MangaDex délié");
  } catch (err) {
    return failed(err);
  }
}

// Fin d'un chapitre dans le lecteur : la progression avance jusqu'à ce numéro (jamais en arrière).
export async function readChapter(mediaId: number, chapter: number): Promise<Feedback> {
  const m = await own(mediaId);
  const n = Math.floor(chapter);
  if (!Number.isFinite(n) || n <= m.progress) return { ok: true, text: "" };
  return stepProgress(mediaId, n - m.progress);
}

// ---------------------------------------------------------------------------------------------
// Synchronisation et réglages

export async function saveAccounts(form: FormData): Promise<Feedback> {
  const uid = await requireUid();
  for (const key of ["anilist_user", "letterboxd_user", "backloggd_user", "mangadex_langs", "steam_user", "pseudo"]) {
    await setSetting(uid, key, String(form.get(key) ?? "").trim());
  }
  return done("Comptes enregistrés");
}

// Couvertures des anime dans les grilles : MyAnimeList ou AniList.
export async function setCoverSource(source: "mal" | "anilist"): Promise<Feedback> {
  const uid = await requireUid();
  await setSetting(uid, "cover_source", source === "anilist" ? "anilist" : "mal");
  return done(source === "anilist" ? "Couvertures AniList" : "Couvertures MyAnimeList");
}

// Clé API Steam : enregistrée seulement si un champ est rempli (le champ reste vide à l'affichage).
export async function saveSteamKey(form: FormData): Promise<Feedback> {
  const uid = await requireUid();
  const key = String(form.get("steam_key") ?? "").trim();
  if (!/^[0-9A-F]{32}$/i.test(key)) return { ok: false, text: "Une clé API Steam fait 32 caractères (0-9, A-F)." };
  await setSetting(uid, "steam_key", key);
  return done("Clé Steam enregistrée");
}

export async function runSteam(): Promise<Feedback> {
  try {
    const r = await syncSteam(await requireUid(), 25000);
    return done(r.message ?? `${r.sessions} session${r.sessions > 1 ? "s" : ""} · ${r.achievements} succès ajoutés au fil`);
  } catch (err) {
    return failed(err);
  }
}

export async function runMalCovers(): Promise<Feedback> {
  try {
    const r = await syncMalCovers(await requireUid(), 25000);
    return done(
      r.left ? `${r.done} couvertures récupérées · encore ${r.left} (relance)` : r.done ? `${r.done} couvertures récupérées, c’est complet` : "Toutes les couvertures MAL sont là",
    );
  } catch (err) {
    return failed(err);
  }
}

export async function saveAnilistToken(token: string): Promise<Feedback> {
  try {
    const uid = await requireUid();
    const name = await viewerName(token);
    await setSetting(uid, "anilist_token", token);
    await setSetting(uid, "anilist_user", name);
    return done(`Connecté à AniList en tant que ${name}`);
  } catch (err) {
    return failed(err);
  }
}

export async function disconnectAnilist(): Promise<Feedback> {
  await setSetting(await requireUid(), "anilist_token", "");
  return done("AniList déconnecté");
}

export async function runAniList(): Promise<Feedback> {
  try {
    const r = await syncAniList(await requireUid());
    return done(`${r.message} · ${r.created} ajoutés · ${r.logs} fins`);
  } catch (err) {
    return failed(err);
  }
}

export async function runLetterboxd(): Promise<Feedback> {
  try {
    const r = await syncLetterboxd(await requireUid());
    return done(`${r.message} · ${r.created} films ajoutés · ${r.logs} visionnages`);
  } catch (err) {
    return failed(err);
  }
}

export async function runBackloggdReviews(): Promise<Feedback> {
  try {
    const n = await syncBackloggdReviews(await requireUid());
    return done(n ? `${n} critique${n > 1 ? "s" : ""} Backloggd importée${n > 1 ? "s" : ""}` : "Aucune critique trouvée (pseudo Backloggd ?)");
  } catch (err) {
    return failed(err);
  }
}

export async function importLetterboxdCsv(_: Feedback | null, form: FormData): Promise<Feedback> {
  try {
    const uid = await requireUid();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return { ok: false, text: "Choisis le fichier diary.csv" };
    const watches = parseDiaryCsv(await file.text());
    const r = await importFilms(uid, watches);
    return done(`${watches.length} lignes lues · ${r.created} films ajoutés · ${r.logs} visionnages. Les affiches se complètent ensuite.`);
  } catch (err) {
    return failed(err);
  }
}

export async function runPosters(): Promise<Feedback> {
  try {
    const n = await completeFilmPosters(await requireUid());
    return done(n ? `${n} affiches trouvées (relance pour continuer)` : "Rien à compléter");
  } catch (err) {
    return failed(err);
  }
}
