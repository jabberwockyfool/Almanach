import "server-only";
import { all, type Media } from "@/lib/db";
import { normTitle } from "@/lib/kinds";

// Rangement de la bibliothèque, d'après les relations AniList, les titres (VNDB, jeux) et les choix manuels.
//
// 1. Séries fusionnées : les volumes d'un light novel ou les films d'une trilogie enchaînés par SEQUEL/PREQUEL
//    (Haruhi, Kizumonogatari, Evangelion Rebuild) ne font qu'une fiche dans la grille, avec « x / N ».
// 2. Parent de chaque fiche, par ordre de priorité :
//    a. rattachement manuel (parent_override : id de la fiche parente, ou 0 pour aucun) ;
//    b. film, OAV, spécial (ou court ONA) → la série TV dont il dépend, en suivant PARENT, puis PREQUEL, puis
//       ALTERNATIVE (films), puis SEQUEL, au besoin à travers des œuvres hors bibliothèque (films intermédiaires) ;
//    c. adaptation → son œuvre d'origine (SOURCE) ;
//    d. œuvre tirée d'un visual novel ou d'un jeu vidéo → le jeu dont un titre correspond.
//    Le parent doit avoir été vu (tout statut sauf « Prévu ») ; on remonte jusqu'à l'original.

const SIDE = new Set(["OVA", "SPECIAL", "MUSIC", "MOVIE"]);
const MAIN = new Set(["TV", "TV_SHORT", "ONA"]);

export type SeriesInfo = { title: string; members: number[]; total: number; done: number; rating: number | null; status: Media["status"] };

export type Grouping<T> = {
  visible: T[];
  // Toutes les fiches rangées sous une fiche visible (adaptations, films, OAV…), dans l'ordre de sortie.
  children: Record<number, T[]>;
  // Parent direct de chaque fiche rangée (pour imbriquer les OAV sous leur série dans l'affichage).
  parentOf: Record<number, number>;
  // Fiche visible qui représente chaque fiche rangée ou fusionnée.
  rootOf: Record<number, number>;
  // Séries fusionnées, par fiche représentante.
  series: Record<number, SeriesInfo>;
};

const GENERIC = new Set([
  "the", "of", "a", "and", "i", "1", "chronicles", "remaster", "remastered", "hd", "edition", "complete", "definitive", "plus",
  "deluxe", "collection", "anniversary", "director", "cut", "reload", "reloaded", "golden", "royal", "portable", "dx", "re", "boot",
]);

// Mots d'un titre ; les chiffres romains seuls (I, V, X) comptent : « Ys X » n'est pas « Ys ».
const words = (t: string) =>
  t.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 || /\d/.test(w) || /^[ivx]$/.test(w));

// Titre commun d'une série (« Suzumiya Haruhi no Yuuutsu », « … no Tameiki » → « Suzumiya Haruhi »).
function seriesTitle(titles: string[]): string {
  const [a, b] = titles;
  if (!b) return a;
  const wa = a.split(/\s+/);
  const wb = b.split(/\s+/);
  let i = 0;
  while (i < wa.length && i < wb.length && wa[i].toLowerCase() === wb[i].toLowerCase()) i++;
  let t = wa.slice(0, i).join(" ").replace(/[\s:：\-–]+$/, "").replace(/\s+(no|the|of|wa|ga)$/i, "");
  t = t.replace(/[\s:：\-–]+$/, "");
  return t.length >= 3 ? t : a.split(/[:：]/)[0].trim();
}

export async function groupAdaptations<T extends Media>(items: T[]): Promise<Grouping<T>> {
  const empty: Grouping<T> = { visible: items, children: {}, parentOf: {}, rootOf: {}, series: {} };
  if (items.length < 2) return empty;
  const byId = new Map(items.map((m) => [m.id, m]));
  const byAnilist = new Map<number, T>();
  for (const m of items) if (m.anilist_id) byAnilist.set(m.anilist_id, m);
  const seen = (m: T | undefined): m is T => Boolean(m && m.status !== "prevu");
  const detached = (m: T) => m.parent_override === 0;

  const rels = await all<{ anilist_id: number; target_id: number; type: string }>(
    "SELECT anilist_id, target_id, type FROM relation WHERE type IN ('SOURCE', 'PARENT', 'PREQUEL', 'SEQUEL', 'ALTERNATIVE')",
  );
  const nodes = new Map((await all<{ anilist_id: number; format: string | null }>("SELECT anilist_id, format FROM relation_node")).map((n) => [n.anilist_id, n.format]));
  const edges = new Map<number, { target: number; type: string }[]>();
  for (const r of rels) edges.set(r.anilist_id, [...(edges.get(r.anilist_id) ?? []), { target: r.target_id, type: r.type }]);
  const formatOf = (anilistId: number) => byAnilist.get(anilistId)?.format ?? nodes.get(anilistId) ?? null;

  // ---- 1. Séries fusionnées (union-find) -------------------------------------------------------
  const up = new Map<number, number>();
  const find = (x: number): number => {
    while (up.has(x) && up.get(x) !== x) x = up.get(x)!;
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) up.set(rb, ra);
  };
  const mergeable = (m: T) => !detached(m) && ((m.kind === "ln" && m.format === "NOVEL") || (m.kind === "anime" && m.format === "MOVIE"));
  for (const m of items) {
    if (!mergeable(m) || !m.anilist_id) continue;
    for (const e of edges.get(m.anilist_id) ?? []) {
      if (e.type !== "SEQUEL" && e.type !== "PREQUEL") continue;
      const t = byAnilist.get(e.target);
      if (t && t.id !== m.id && mergeable(t) && t.format === m.format) union(m.id, t.id);
    }
  }
  // Volumes de light novel au titre commun (au moins 3 mots), que les relations AniList ne relient pas toutes.
  const novels = items.filter((m) => m.kind === "ln" && m.format === "NOVEL" && !detached(m));
  for (let i = 0; i < novels.length; i++) {
    for (let j = i + 1; j < novels.length; j++) {
      const a = novels[i].title.split(/\s+/);
      const b = novels[j].title.split(/\s+/);
      let k = 0;
      while (k < a.length && k < b.length && a[k].toLowerCase() === b[k].toLowerCase()) k++;
      if (k >= 3 && a.slice(0, k).join(" ").length >= 12) union(novels[i].id, novels[j].id);
    }
  }
  const groups = new Map<number, T[]>();
  for (const m of items) {
    if (!up.has(m.id)) continue;
    const r = find(m.id);
    groups.set(r, [...(groups.get(r) ?? []), m]);
  }
  for (const r of [...groups.keys()]) if (!groups.get(r)!.some((m) => m.id === r)) groups.get(r)!.push(byId.get(r)!);
  // Taille connue de la série : les œuvres du même format reliées en chaîne, y compris hors bibliothèque.
  const chainSize = (startIds: number[], format: string | null) => {
    const seenIds = new Set<number>();
    const queue = [...startIds];
    while (queue.length && seenIds.size < 60) {
      const id = queue.shift()!;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      for (const e of edges.get(id) ?? []) {
        if ((e.type === "SEQUEL" || e.type === "PREQUEL") && formatOf(e.target) === format && !seenIds.has(e.target)) queue.push(e.target);
      }
    }
    return seenIds.size;
  };
  const series: Record<number, SeriesInfo> = {};
  const seriesRootOf = new Map<number, number>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || (a.anilist_id ?? a.id) - (b.anilist_id ?? b.id));
    const head = members[0];
    const rated = members.filter((m) => m.rating != null);
    const done = members.filter((m) => m.status === "termine").length;
    const total = Math.max(members.length, chainSize(members.map((m) => m.anilist_id!).filter(Boolean), head.format));
    series[head.id] = {
      title: seriesTitle(members.map((m) => m.title)),
      members: members.map((m) => m.id),
      total,
      done,
      rating: rated.length ? Math.round((rated.reduce((s, m) => s + m.rating!, 0) / rated.length) * 2) / 2 : null,
      status: done >= total ? "termine" : members.some((m) => m.status === "en_cours" || m.status === "termine") ? "en_cours" : head.status,
    };
    for (const m of members) seriesRootOf.set(m.id, head.id);
  }
  // Une fiche de série est représentée par la première.
  const rep = (m: T): T => byId.get(seriesRootOf.get(m.id) ?? m.id)!;

  // ---- 2. Parents ------------------------------------------------------------------------------
  // Jeux vus, avec leurs titres (VNDB pour les VN) et les mots de leur titre principal (avant « : »).
  const aliasRows = await all<{ media_id: number; title: string }>("SELECT media_id, title FROM alias");
  const titles = new Map<number, Set<string>>();
  for (const m of items) titles.set(m.id, new Set([normTitle(m.title)]));
  for (const a of aliasRows) titles.get(a.media_id)?.add(normTitle(a.title));
  const allTitles = new Map<number, string[]>();
  for (const a of aliasRows) if (byId.has(a.media_id)) allTitles.set(a.media_id, [...(allTitles.get(a.media_id) ?? []), a.title]);
  const games = items.filter((m) => m.kind === "jeu" && seen(m) && !detached(m));

  // Jeu d'origine d'une œuvre tirée d'un VN ou d'un jeu vidéo.
  const gameFor = (child: T): T | undefined => {
    const own = [...(titles.get(child.id) ?? [])].filter((t) => t.length >= 2);
    const ownWords = new Set([child.title, ...(allTitles.get(child.id) ?? [])].flatMap(words));
    const strict = child.source !== "VISUAL_NOVEL" && child.source !== "VIDEO_GAME"; // titre seul : plus exigeant
    let best: T | undefined;
    let score = 0;
    for (const g of games) {
      // VN : titres VNDB identiques, ou l'un qui commence par l'autre.
      if (!strict) {
        for (const t of titles.get(g.id) ?? []) {
          for (const c of own) {
            const s = c === t ? 10_000 + t.length : t.length >= 6 && c.startsWith(t) ? 5_000 + t.length : c.length >= 6 && t.startsWith(c) ? 5_000 + c.length : 0;
            if (s > score) [score, best] = [s, g];
          }
        }
      }
      // Jeu vidéo : mots du titre principal du jeu tous présents dans l'œuvre (« Persona 4 Golden » dans
      // « Persona 4 the Golden Animation »), ou l'inverse (« Ys » dans « Ys I Chronicles+ » : on préfère le
      // jeu qui ajoute le moins de mots, hors mots génériques comme « I » ou « Chronicles »).
      const gw = words(g.title.split(/[:：]/)[0]);
      if (gw.length && gw.every((w) => ownWords.has(w)) && (!strict || gw.length >= 3)) {
        const s = 3_000 + gw.length * 10;
        if (s > score) [score, best] = [s, g];
      } else if (!strict) {
        const cw = words(child.title.split(/[:：]/)[0]);
        if (cw.length && cw.every((w) => gw.includes(w))) {
          const extra = gw.filter((w) => !cw.includes(w) && !GENERIC.has(w)).length;
          const s = 2_000 - extra * 10 + cw.length;
          if (s > score) [score, best] = [s, g];
        }
      }
    }
    return best;
  };

  // Série TV d'un film, d'un OAV ou d'un spécial : parcours des relations, à travers des œuvres hors bibliothèque.
  const mainFor = (child: T): T | undefined => {
    if (!child.anilist_id) return undefined;
    // Films : la chaîne peut passer par d'autres films et une version ALTERNATIVE (Fukkatsu no Lelouch → films III,
    // II, I → série Code Geass). OAV et spéciaux : PARENT/PREQUEL, sinon la suite (Reloaded → Outer Code → Ares).
    const plans: string[][] =
      child.format === "MOVIE" ? [["PARENT", "PREQUEL", "ALTERNATIVE"], ["SEQUEL", "PARENT"]] : [["PARENT", "PREQUEL"], ["SEQUEL"]];
    for (const allowed of plans) {
      const visited = new Set<number>([child.anilist_id]);
      let frontier = [child.anilist_id];
      for (let depth = 0; depth < 5 && frontier.length; depth++) {
        const next: number[] = [];
        for (const id of frontier) {
          for (const e of edges.get(id) ?? []) {
            if (!allowed.includes(e.type) || visited.has(e.target)) continue;
            visited.add(e.target);
            const t = byAnilist.get(e.target);
            // Une série principale arrête la recherche ; un film ou un OAV (vu ou non) sert de relais.
            if (t && t.kind === child.kind && seen(t) && !detached(t) && MAIN.has(t.format ?? "") && !(t.format === "ONA" && (t.total ?? 99) <= 6)) {
              return t;
            }
            next.push(e.target);
          }
        }
        frontier = next;
      }
    }
    return undefined;
  };

  const parent = new Map<number, T>();
  for (const m of items) {
    if (seriesRootOf.has(m.id) && seriesRootOf.get(m.id) !== m.id) continue; // membre de série : représenté par la première
    if (m.parent_override === 0) continue;
    if (m.parent_override) {
      const p = byId.get(m.parent_override);
      if (p && p.id !== m.id) parent.set(m.id, rep(p));
      continue;
    }
    const side = m.kind === "anime" && !series[m.id] && (SIDE.has(m.format ?? "") || (m.format === "ONA" && m.total != null && m.total <= 6));
    let p: T | undefined;
    if (side) p = mainFor(m);
    if (!p && m.anilist_id) {
      const ids = series[m.id] ? series[m.id].members.map((id) => byId.get(id)!.anilist_id!).filter(Boolean) : [m.anilist_id];
      for (const id of ids) {
        for (const e of edges.get(id) ?? []) {
          const t = byAnilist.get(e.target);
          if (e.type === "SOURCE" && t && seen(t) && !detached(t) && rep(t).id !== m.id) p ??= t;
        }
      }
    }
    if (!p && (m.kind === "anime" || m.kind === "manga" || m.kind === "ln")) p = gameFor(m);
    if (p) {
      const r = rep(p);
      if (r.id !== m.id) parent.set(m.id, r);
    }
  }

  // Boucles (A adaptation de B et B de A, par exemple un choix manuel à rebours du rangement automatique) :
  // on coupe le lien automatique de la boucle, ou à défaut celui de la plus petite fiche, sinon tout y disparaîtrait.
  for (const start of [...parent.keys()]) {
    const path: number[] = [];
    let cur: number | undefined = start;
    while (cur !== undefined && parent.has(cur) && !path.includes(cur)) {
      path.push(cur);
      cur = parent.get(cur)!.id;
    }
    if (cur === undefined || !path.includes(cur)) continue;
    const loop = path.slice(path.indexOf(cur));
    const auto = loop.find((id) => !byId.get(id)?.parent_override);
    parent.delete(auto ?? Math.min(...loop));
  }

  // ---- 3. Arbres -------------------------------------------------------------------------------
  const rootOf: Record<number, number> = {};
  const parentOf: Record<number, number> = {};
  const root = (m: T): T => {
    let cur = rep(m);
    const path = new Set<number>([cur.id]);
    while (parent.has(cur.id)) {
      const next = parent.get(cur.id)!;
      if (path.has(next.id)) break; // relations circulaires
      path.add(next.id);
      cur = next;
    }
    return cur;
  };
  const visible: T[] = [];
  const children: Record<number, T[]> = {};
  for (const m of items) {
    const r = root(m);
    if (r.id === m.id) {
      visible.push(m);
      continue;
    }
    rootOf[m.id] = r.id;
    if (seriesRootOf.has(m.id) && seriesRootOf.get(m.id) !== m.id) continue; // volume d'une série : pas une adaptation
    (children[r.id] ??= []).push(m);
    const p = parent.get(m.id);
    if (p) parentOf[m.id] = p.id;
  }
  for (const list of Object.values(children)) list.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title));
  return { visible, children, parentOf, rootOf, series };
}
