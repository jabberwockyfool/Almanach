import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { InValue } from "@libsql/client";
import { all, type Media } from "@/lib/db";
import { groupAdaptations } from "@/lib/groups";
import { KINDS, KIND_PLURAL, SORTS, STATUSES, THEN_SORTS, isKind, isSort, isStatus, isThenSort, type Sort, type ThenSort } from "@/lib/kinds";
import { getUser, requireUser } from "@/lib/user";
import { LibraryGrid } from "./library-grid";
import { withCovers } from "@/lib/prefs";

export const metadata = { title: "Bibliothèque" };

// Premier critère (sans valeur en dernier), puis second critère réglable (« puis par »).
const ORDER: Record<Sort, string> = {
  note: "rating IS NULL, rating DESC",
  recent: "updated_at DESC",
  ajout: "created_at DESC",
  fin: "last_finish IS NULL, last_finish DESC",
  titre: "title COLLATE NOCASE",
  sortie: "year IS NULL, year DESC",
};
const THEN: Record<ThenSort, string> = {
  recent: "updated_at DESC",
  ajout: "created_at DESC",
  fin: "last_finish IS NULL, last_finish DESC",
  titre: "title COLLATE NOCASE",
  sortie: "year IS NULL, year DESC",
};

export default async function Library({ searchParams }: PageProps<"/bibliotheque">) {
  await connection();
  const me = await requireUser();
  const sp = await searchParams;
  // Bibliothèque d'un autre compte du groupe, en lecture seule (?u=id).
  const owner = sp.u ? await getUser(Number(sp.u)) : me;
  if (!owner || owner.status === "pending") notFound();
  const editable = owner.id === me.id;
  const uid = owner.id;
  const type = isKind(sp.type) ? sp.type : null;
  const statut = isStatus(sp.statut) ? sp.statut : null;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  // Par défaut : tout, du mieux noté au moins bien noté, à note égale le plus récemment modifié.
  const tri: Sort = isSort(sp.tri) ? sp.tri : "note";
  const puis: ThenSort = isThenSort(sp.puis) ? sp.puis : "recent";
  // Les OVA qui n'ont pas trouvé de série sont masqués sauf demande (?ova=1) ; les autres apparaissent au
  // survol de leur original.
  const ova = sp.ova === "1";

  // La bibliothèque d'un autre compte ne montre pas ses fiches privées.
  const where: string[] = editable ? ["user_id = ?"] : ["user_id = ?", "private = 0"];
  const args: InValue[] = [uid];
  if (type) (where.push("kind = ?"), args.push(type));
  if (statut) (where.push("status = ?"), args.push(statut));
  // Recherche dans les titres, l'auteur et les autres titres (AniList, VNDB, ajoutés à la main).
  if (q) {
    where.push(`(title LIKE ? OR subtitle LIKE ? OR author LIKE ?
      OR id IN (SELECT media_id FROM title_alias WHERE title LIKE ?) OR id IN (SELECT media_id FROM alias WHERE title LIKE ?))`);
    args.push(...Array(5).fill(`%${q}%`));
  }
  const rows = await withCovers(await all<Media & { last_finish: string | null }>(
    `SELECT *, (SELECT MAX(finished_on) FROM log WHERE log.media_id = media.id) AS last_finish
     FROM media WHERE ${where.join(" AND ")} ORDER BY ${ORDER[tri]}, ${THEN[puis]}, id DESC LIMIT 3000`,
    args,
  ));
  // Rangement calculé sur toute la bibliothèque : une adaptation ne quitte la grille que si son original y est
  // affiché, et l'original montre ses adaptations même quand un filtre les exclut (onglet Light novels…).
  const family = await groupAdaptations(await withCovers(await all<Media>(`SELECT * FROM media WHERE user_id = ?${editable ? "" : " AND private = 0"}`, [uid])));
  const shown = new Set(rows.map((m) => m.id));
  const visible = rows.filter((m) => !family.rootOf[m.id] || !shown.has(family.rootOf[m.id]));
  const children: Record<number, Media[]> = {};
  const series: typeof family.series = {};
  for (const m of visible) {
    if (family.children[m.id]) children[m.id] = family.children[m.id];
    if (family.series[m.id]) series[m.id] = family.series[m.id];
  }
  const items = ova ? visible : visible.filter((m) => m.format !== "OVA");
  const hiddenOva = visible.length - items.length;

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const next = {
      u: editable ? null : String(owner.id),
      type,
      statut,
      q: q || null,
      tri: tri !== "note" ? tri : null,
      puis: puis !== "recent" ? puis : null,
      ova: ova ? "1" : null,
      ...patch,
    };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return `/bibliotheque${s ? `?${s}` : ""}`;
  };
  // Liens précalculés pour la grille (composant client) : onglets de statut et tris.
  const hrefFor: Record<string, string> = { tous: href({ statut: null }), ova: href({ ova: ova ? null : "1" }) };
  for (const s of STATUSES) hrefFor[s] = href({ statut: s });
  for (const k of Object.keys(SORTS)) hrefFor[`tri:${k}`] = href({ tri: k === "note" ? null : k });
  for (const k of Object.keys(THEN_SORTS)) hrefFor[`puis:${k}`] = href({ puis: k === "recent" ? null : k });
  const chip = (on: boolean) => (on ? "font-semibold text-fg" : "text-muted hover:text-fg");

  return (
    <div className="space-y-5">
      {!editable && (
        <p className="text-sm text-muted">
          Bibliothèque de <Link href={`/u/${owner.id}`} className="link text-fg">{owner.name}</Link> (lecture seule)
        </p>
      )}
      <form className="flex gap-2" action="/bibliotheque">
        {!editable && <input type="hidden" name="u" value={owner.id} />}
        {type && <input type="hidden" name="type" value={type} />}
        {statut && <input type="hidden" name="statut" value={statut} />}
        {tri !== "note" && <input type="hidden" name="tri" value={tri} />}
        {puis !== "recent" && <input type="hidden" name="puis" value={puis} />}
        {ova && <input type="hidden" name="ova" value="1" />}
        <input name="q" defaultValue={q} placeholder="Chercher dans la bibliothèque" className="flex-1" />
      </form>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href={href({ type: null })} className={chip(!type)}>Tout</Link>
        {KINDS.map((k) => (
          <Link key={k} href={href({ type: k })} className={chip(type === k)}>{KIND_PLURAL[k]}</Link>
        ))}
      </p>
      <LibraryGrid
        key={`${owner.id}-${type}-${statut}-${q}-${tri}-${puis}-${ova}`}
        items={items}
        statut={statut}
        sort={tri}
        then={puis}
        hrefFor={hrefFor}
        ova={ova}
        hiddenOva={hiddenOva}
        adaptations={children}
        parentOf={family.parentOf}
        series={series}
        editable={editable}
      />
      {!items.length && <p className="text-muted">Aucun média.</p>}
    </div>
  );
}
