import "server-only";
import { all, batch, get, getSetting, run, setSetting, type Media, type Stmt } from "@/lib/db";
import { KIND_UNIT, type Kind } from "@/lib/kinds";

// Fil d'activité d'Almanach. Chaque chose faite devient un événement daté, rattaché à un compte :
//   progress     { from, to }            épisodes / chapitres / volumes
//   finish       { rewatch?, rating? }   média terminé
//   rating       { rating }              note donnée hors d'une fin
//   playtime     { minutes }             session de jeu (journal Backloggd, Steam)
//   achievements { count, items }        succès Steam
//   start / plan / drop / pause          statuts (appli ou AniList)
// Les imports portent une ref unique par compte : relancer une synchro ne crée rien en double.

export type EventType = "progress" | "finish" | "rating" | "playtime" | "achievements" | "start" | "plan" | "drop" | "pause";

export type EventRow = {
  id: number;
  user_id: number;
  at: number;
  type: EventType;
  media_id: number | null;
  title: string;
  cover: string;
  data: string;
  source: string;
};

export type NewEvent = {
  at: number;
  type: EventType;
  media_id?: number | null;
  title?: string;
  cover?: string;
  data?: object;
  source?: string;
  ref?: string;
};

const now = () => Math.floor(Date.now() / 1000);

// Jour sans heure (fins, sessions du journal) : placé à midi heure locale.
export function dayToTs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d, 12).getTime() / 1000);
}

function insertStmt(uid: number, e: NewEvent): Stmt {
  return {
    sql: "INSERT OR IGNORE INTO event (user_id, at, type, media_id, title, cover, data, source, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [uid, e.at, e.type, e.media_id ?? null, e.title ?? "", e.cover ?? "", JSON.stringify(e.data ?? {}), e.source ?? "app", e.ref ?? null],
  };
}

export async function addEvents(uid: number, events: NewEvent[]) {
  if (events.length) await batch(events.map((e) => insertStmt(uid, e)));
}

// Avancée faite dans l'appli. Les +1 successifs (moins de 3 h d'écart) se regroupent : « épisodes 3 - 5 ».
export async function recordProgress(m: Media, from: number, to: number) {
  if (to <= from) return;
  const last = await get<{ id: number; at: number; data: string }>(
    "SELECT id, at, data FROM event WHERE user_id = ? AND media_id = ? AND type = 'progress' AND source = 'app' ORDER BY at DESC LIMIT 1",
    [m.user_id, m.id],
  );
  if (last && now() - last.at < 3 * 3600) {
    const d = JSON.parse(last.data) as { from: number; to: number };
    if (d.to === from) {
      await run("UPDATE event SET at = ?, data = ? WHERE id = ?", [now(), JSON.stringify({ from: d.from, to }), last.id]);
      return;
    }
  }
  await addEvents(m.user_id, [{ at: now(), type: "progress", media_id: m.id, data: { from: from + 1, to } }]);
}

// Une fin a toujours la même référence (fiche + date) : celle notée dans l'appli, celle reprise de
// l'historique et celle d'un import ne font qu'un événement.
export const finishRef = (mediaId: number, day: string) => `fin:${mediaId}:${day}`;

export async function recordFinish(m: Media, rewatch: boolean, rating: number | null, day: string) {
  await addEvents(m.user_id, [{ at: now(), type: "finish", media_id: m.id, data: { rewatch, rating }, ref: finishRef(m.id, day) }]);
}

// Après un import (Backloggd, Letterboxd, AniList) : événements des nouvelles fins datées au jour près et
// des sessions de jeu du journal. Une session déjà vue par Steam le même jour n'est pas doublée.
export async function eventsFromImport(uid: number, startedAt: string) {
  const logs = await all<{ media_id: number; finished_on: string; rewatch: number; rating: number | null; source: string }>(
    `SELECT log.media_id, log.finished_on, log.rewatch, log.rating, log.source FROM log JOIN media ON media.id = log.media_id
     WHERE media.user_id = ? AND length(log.finished_on) = 10 AND log.created_at >= ?`,
    [uid, startedAt],
  );
  const events: NewEvent[] = logs.map((l) => ({
    at: dayToTs(l.finished_on) + 60,
    type: "finish" as const,
    media_id: l.media_id,
    data: { rewatch: Boolean(l.rewatch), rating: l.rating },
    source: l.source,
    ref: finishRef(l.media_id, l.finished_on),
  }));
  const sessions = await all<{ media_id: number; day: string; minutes: number }>(
    `SELECT a.media_id, a.day, a.minutes FROM activity a JOIN media ON media.id = a.media_id
     WHERE media.user_id = ? AND a.source = 'backloggd' AND a.minutes > 0
       AND NOT EXISTS (SELECT 1 FROM event e WHERE e.user_id = ? AND e.ref = 'play:' || a.media_id || ':' || a.day || ':backloggd')`,
    [uid, uid],
  );
  for (const s of sessions) {
    const steam = await get(
      "SELECT id FROM event WHERE user_id = ? AND media_id = ? AND type = 'playtime' AND source = 'steam' AND at BETWEEN ? AND ?",
      [uid, s.media_id, dayToTs(s.day) - 12 * 3600, dayToTs(s.day) + 12 * 3600],
    );
    if (steam) continue;
    events.push({ at: dayToTs(s.day), type: "playtime", media_id: s.media_id, data: { minutes: s.minutes }, source: "backloggd", ref: `play:${s.media_id}:${s.day}:backloggd` });
  }
  await addEvents(uid, events);
}

// Changement de statut fait dans l'appli : commencé, prévu, en pause, abandonné (la fin a son propre événement).
export async function recordStatus(m: Media, before: string | null, after: string) {
  const type = ({ en_cours: "start", prevu: "plan", pause: "pause", abandonne: "drop" } as const)[after as "en_cours"];
  if (!type || before === after) return;
  await addEvents(m.user_id, [{ at: now(), type, media_id: m.id }]);
}

// Une note donnée juste après une fin complète cette fin ; sinon c'est un événement à part.
export async function recordRating(m: Media, rating: number | null) {
  if (rating == null) return;
  const finish = await get<{ id: number; data: string }>(
    "SELECT id, data FROM event WHERE user_id = ? AND media_id = ? AND type = 'finish' AND at > ? ORDER BY at DESC LIMIT 1",
    [m.user_id, m.id, now() - 3600],
  );
  if (finish) {
    await run("UPDATE event SET data = ? WHERE id = ?", [JSON.stringify({ ...JSON.parse(finish.data), rating }), finish.id]);
    return;
  }
  // Une note seule n'est pas une activité : rien d'autre dans le fil.
}

// Reprise de l'historique d'un compte : fins datées au jour près et activité au jour le jour déjà dans la
// base, pour que le fil ne démarre pas vide.
export async function backfillEvents(uid: number) {
  if (await getSetting(uid, "events_backfilled")) return;
  const logs = await all<{ media_id: number; finished_on: string; rewatch: number; rating: number | null; source: string }>(
    `SELECT log.media_id, log.finished_on, log.rewatch, log.rating, log.source FROM log JOIN media ON media.id = log.media_id
     WHERE media.user_id = ? AND length(log.finished_on) = 10`,
    [uid],
  );
  const acts = await all<{ media_id: number; day: string; amount: number; minutes: number; source: string }>(
    "SELECT a.media_id, a.day, a.amount, a.minutes, a.source FROM activity a JOIN media ON media.id = a.media_id WHERE media.user_id = ?",
    [uid],
  );
  const events: NewEvent[] = [];
  for (const l of logs) {
    events.push({ at: dayToTs(l.finished_on) + 60, type: "finish", media_id: l.media_id, data: { rewatch: Boolean(l.rewatch), rating: l.rating }, source: l.source, ref: finishRef(l.media_id, l.finished_on) });
  }
  for (const a of acts) {
    if (a.minutes > 0) events.push({ at: dayToTs(a.day), type: "playtime", media_id: a.media_id, data: { minutes: a.minutes }, source: a.source, ref: `play:${a.media_id}:${a.day}:${a.source}` });
    else if (a.amount > 0) events.push({ at: dayToTs(a.day), type: "progress", media_id: a.media_id, data: { count: a.amount }, source: a.source, ref: `prog:${a.media_id}:${a.day}` });
  }
  await addEvents(uid, events);
  await setSetting(uid, "events_backfilled", new Date().toISOString());
}

// ---------------------------------------------------------------------------------------------
// Lecture du fil

export type FeedItem = {
  id: number;
  at: number;
  mine: boolean; // activité du compte qui regarde : il peut la retirer du fil
  user: { id: number; name: string; avatar: string };
  text: string; // « a joué 3 h à », « a reçu 2 succès sur »…
  title: string;
  cover: string;
  href: string | null;
  rating: number | null;
  detail: string; // noms des succès, etc.
  icons: { name: string; icon: string }[]; // icônes des succès Steam
};

function unitPhrase(kind: Kind, from: number | undefined, to: number | undefined, count: number | undefined, forced?: string): string {
  const unit = forced ?? KIND_UNIT[kind] ?? "épisode";
  const watch = unit === "épisode";
  const verb = watch ? "a regardé" : "a lu";
  if (from != null && to != null) {
    if (from === to) return `${verb} ${unit === "épisode" ? "l’épisode" : unit === "page" ? "la page" : `le ${unit}`} ${to} de`;
    return `${verb} les ${unit}s ${from} - ${to} de`;
  }
  if (count) return `${verb} ${count > 1 ? `${count} ${unit}s` : unit === "page" ? "une page" : `un ${unit}`} de`;
  return `${verb}`;
}

function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} min`;
}

// Fil d'un compte (uid) ou de tous les comptes approuvés (uid null). Pagination sur (heure, id) : plusieurs
// événements partagent souvent la même heure (fins d'un même jour à midi).
// viewer : compte qui regarde (les fiches privées des autres sont exclues).
export async function readFeed(viewer: number, uid: number | null, before: { at: number; id: number } | null, limit = 30): Promise<FeedItem[]> {
  const rows = await all<
    EventRow & { kind: Kind | null; m_title: string | null; m_cover: string | null; m_grid: string | null; u_name: string; u_avatar: string; u_pseudo: string | null; u_al_avatar: string | null }
  >(
    `SELECT event.*, media.kind, media.title AS m_title, media.cover AS m_cover, media.cover_grid AS m_grid,
            users.name AS u_name, users.avatar AS u_avatar,
            (SELECT value FROM user_setting WHERE user_id = event.user_id AND key = 'pseudo') AS u_pseudo,
            (SELECT value FROM user_setting WHERE user_id = event.user_id AND key = 'avatar') AS u_al_avatar
     FROM event JOIN users ON users.id = event.user_id LEFT JOIN media ON media.id = event.media_id
     WHERE users.status <> 'pending' AND (? IS NULL OR event.user_id = ?) AND event.hidden = 0 AND event.type <> 'rating'
       AND (event.user_id = ? OR COALESCE(media.private, 0) = 0)
       AND (event.at < ? OR (event.at = ? AND event.id < ?))
     ORDER BY event.at DESC, event.id DESC LIMIT ?`,
    [uid, uid, viewer, ...(before ? [before.at, before.at, before.id] : [now() + 86400 * 365, 0, 0]), limit],
  );
  const anilistCovers = (await getSetting(viewer, "cover_source")) === "anilist";
  return rows.map((r) => {
    const d = JSON.parse(r.data) as Record<string, unknown>;
    // Type : celui de la fiche, sinon celui gardé à l'import (AniList) ; inconnu → tournures neutres.
    const kind = (r.kind ?? (typeof d.kind === "string" ? d.kind : null)) as Kind | null;
    let text = "";
    switch (r.type) {
      case "progress":
        text = unitPhrase(kind ?? "manga", d.from as number | undefined, d.to as number | undefined, d.count as number | undefined,
          (d.unit as string | undefined) ?? (r.source === "anilist" ? (kind === "anime" ? "épisode" : "chapitre") : undefined));
        break;
      case "finish":
        text = d.rewatch
          ? kind === "jeu" ? "a refini" : kind === "film" || kind === "serie" || kind === "anime" ? "a revu" : "a relu"
          : kind === "film" ? "a vu" : kind === "jeu" ? "a fini" : kind === "roman" ? "a lu" : "a terminé";
        if (d.rewatch && !kind) text = "a refait";
        break;
      case "rating":
        text = "a noté";
        break;
      case "playtime":
        text = `a joué ${duration(Number(d.minutes))} à`;
        break;
      case "achievements":
        text = `a reçu ${Number(d.count)} succès sur`;
        break;
      case "start":
        text = !kind ? "a commencé" : kind === "anime" || kind === "serie" || kind === "film" ? "a commencé à regarder" : kind === "jeu" ? "a commencé à jouer à" : "a commencé à lire";
        break;
      case "plan":
        text = !kind ? "a mis de côté" : kind === "anime" || kind === "serie" || kind === "film" ? "prévoit de regarder" : kind === "jeu" ? "prévoit de jouer à" : "prévoit de lire";
        break;
      case "drop":
        text = "a abandonné";
        break;
      case "pause":
        text = "a mis en pause";
        break;
    }
    const names = Array.isArray(d.names) ? (d.names as string[]) : [];
    return {
      id: r.id,
      at: r.at,
      mine: r.user_id === viewer,
      user: { id: r.user_id, name: r.u_pseudo || r.u_name || "?", avatar: r.u_avatar || r.u_al_avatar || "" },
      text,
      title: r.m_title ?? r.title,
      cover: (anilistCovers ? null : r.m_grid) || r.m_cover || r.cover,
      // Les fiches des autres comptes s'ouvrent en lecture seule.
      href: r.media_id ? `/media/${r.media_id}` : null,
      rating: typeof d.rating === "number" ? d.rating : null,
      detail: names.slice(0, 4).join(" · ") + (names.length > 4 ? ` · +${names.length - 4}` : ""),
      icons: Array.isArray(d.items) ? (d.items as { name: string; icon: string }[]).filter((i) => i.icon) : [],
    };
  });
}
