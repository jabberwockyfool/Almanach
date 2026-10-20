import "server-only";
import { all, get } from "@/lib/db";
import { KINDS, type Kind } from "@/lib/kinds";

// Une fin datée au moins à l'année : finished_on peut être « AAAA », « AAAA-MM » ou « AAAA-MM-JJ ».
export type Finish = {
  log_id: number;
  finished_on: string;
  log_rating: number | null;
  rewatch: number;
  unknown: number;
  id: number;
  kind: Kind;
  title: string;
  cover: string;
  cover_grid: string;
  total: number | null;
  rating: number | null;
};

export async function finishesOf(uid: number, year: number, kind?: Kind | null): Promise<Finish[]> {
  return all<Finish>(
    `${FINISH_SELECT} WHERE media.user_id = ? AND substr(log.finished_on, 1, 4) = ? ${kind ? "AND media.kind = ?" : ""}
     ORDER BY log.finished_on, log.id`,
    kind ? [uid, String(year), kind] : [uid, String(year)],
  );
}

export const FINISH_SELECT = `SELECT log.id AS log_id, log.finished_on, log.rating AS log_rating, log.rewatch, log.unknown,
            media.id, media.kind, media.title, media.cover, media.cover_grid, media.total, media.rating
     FROM log JOIN media ON media.id = log.media_id`;

// Fins à dater : sans date, et pas marquées « date inconnue ».
export async function undatedCount(uid: number): Promise<number> {
  return (
    (await get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM log JOIN media ON media.id = log.media_id WHERE media.user_id = ? AND log.finished_on IS NULL AND log.unknown = 0",
      [uid],
    ))?.n ?? 0
  );
}

export type Wrapped = {
  year: number;
  total: number;
  byKind: { kind: Kind; count: number; covers: { title: string; cover: string }[] }[];
  byMonth: number[];
  topMonth: number;
  favorites: { title: string; cover: string; kind: Kind; rating: number }[];
  first: Finish | null;
  last: Finish | null;
  busiestDay: { day: string; count: number } | null;
  gameMinutes: number;
  episodes: number;
  chapters: number;
  volumes: number;
  pages: number;
  streak: number;
  rewatches: number;
  covers: { title: string; cover: string; kind: Kind }[];
};

export async function wrapped(uid: number, year: number): Promise<Wrapped> {
  const list = await finishesOf(uid, year);
  const byMonth = Array(12).fill(0) as number[];
  const perDay = new Map<string, number>();
  for (const f of list) {
    if (f.finished_on.length >= 7) byMonth[Number(f.finished_on.slice(5, 7)) - 1]++;
    if (f.finished_on.length === 10) perDay.set(f.finished_on, (perDay.get(f.finished_on) ?? 0) + 1);
  }
  const dated = list.filter((f) => f.finished_on.length === 10);
  const busiest = [...perDay].sort((a, b) => b[1] - a[1])[0];

  // Note de la fin si elle existe, sinon celle de la fiche ; une œuvre n'apparaît qu'une fois.
  const seen = new Set<number>();
  const favorites = list
    .map((f) => ({ ...f, r: f.log_rating ?? f.rating }))
    .filter((f) => f.r != null)
    .sort((a, b) => b.r! - a.r! || b.finished_on.localeCompare(a.finished_on))
    .filter((f) => !seen.has(f.id) && seen.add(f.id))
    .slice(0, 5)
    .map((f) => ({ title: f.title, cover: f.cover, kind: f.kind, rating: f.r! }));

  const activity = await all<{ day: string; kind: Kind; amount: number; minutes: number }>(
    `SELECT activity.day, media.kind, activity.amount, activity.minutes FROM activity JOIN media ON media.id = activity.media_id
     WHERE media.user_id = ? AND activity.day >= ? AND activity.day <= ?`,
    [uid, `${year}-01-01`, `${year}-12-31`],
  );
  const gameMinutes = activity.filter((a) => a.kind === "jeu").reduce((s, a) => s + a.minutes, 0);

  // Épisodes et chapitres : le total des œuvres terminées dans l'année (approximation, les revisionnages comptent).
  const sumTotal = (kinds: Kind[]) => list.filter((f) => kinds.includes(f.kind)).reduce((s, f) => s + (f.total ?? 0), 0);

  // Plus longue suite de jours avec au moins une fin ou une activité.
  const days = [...new Set([...perDay.keys(), ...activity.map((a) => a.day)])].sort();
  let streak = 0;
  let run = 0;
  let prev = 0;
  for (const d of days) {
    const t = Date.parse(`${d}T00:00:00Z`) / 86400000;
    run = t - prev === 1 ? run + 1 : 1;
    prev = t;
    streak = Math.max(streak, run);
  }

  return {
    year,
    total: list.length,
    byKind: KINDS.map((kind) => {
      const of = list.filter((f) => f.kind === kind);
      return { kind, count: of.length, covers: of.filter((f) => f.cover).slice(-12).map((f) => ({ title: f.title, cover: f.cover })) };
    }).filter((k) => k.count > 0),
    byMonth,
    topMonth: byMonth.indexOf(Math.max(...byMonth)),
    favorites,
    first: dated[0] ?? null,
    last: dated[dated.length - 1] ?? null,
    busiestDay: busiest ? { day: busiest[0], count: busiest[1] } : null,
    gameMinutes,
    episodes: sumTotal(["anime", "serie"]),
    chapters: sumTotal(["manga"]),
    volumes: sumTotal(["ln"]),
    pages: sumTotal(["roman"]),
    streak,
    rewatches: list.filter((f) => f.rewatch).length,
    covers: list.filter((f) => f.cover).map((f) => ({ title: f.title, cover: f.cover, kind: f.kind })),
  };
}
