import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { all, get, getSetting, type Media } from "@/lib/db";
import { KINDS, KIND_LABEL, KIND_PLURAL, type Kind } from "@/lib/kinds";
import { getUser, listUsers, requireUser } from "@/lib/user";
import { Cover } from "@/components/cover";
import { Stars } from "@/components/stars";
import { withCovers } from "@/lib/prefs";

export async function generateMetadata({ params }: PageProps<"/u/[id]">) {
  const u = await getUser(Number((await params).id));
  return { title: u?.name ?? "Profil" };
}

// Profil d'un compte : favoris par type (le premier porte la couronne), chiffres, accès à sa bibliothèque.
export default async function Profile({ params }: PageProps<"/u/[id]">) {
  await connection();
  const me = await requireUser();
  const user = await getUser(Number((await params).id));
  if (!user || user.status === "pending") notFound();
  const mine = user.id === me.id;
  const pseudo = (await getSetting(user.id, "pseudo")) || user.name;
  const avatar = user.avatar || (await getSetting(user.id, "avatar"));
  const year = new Date().getFullYear();

  // Fiches privées : visibles de leur seul propriétaire.
  const hidden = mine ? "" : " AND media.private = 0";
  const favs = await withCovers(await all<Media>(`SELECT * FROM media WHERE user_id = ? AND fav_rank IS NOT NULL${hidden} ORDER BY fav_rank`, [user.id]));
  const counts = await all<{ kind: Kind; total: number; thisYear: number }>(
    `SELECT media.kind, COUNT(DISTINCT media.id) AS total,
            COUNT(DISTINCT CASE WHEN log.finished_on LIKE ? THEN log.id END) AS thisYear
     FROM media LEFT JOIN log ON log.media_id = media.id
     WHERE media.user_id = ? AND media.status = 'termine'${hidden} GROUP BY media.kind`,
    [`${year}%`, user.id],
  );
  const ratingCount = (await get<{ n: number }>(`SELECT COUNT(*) AS n FROM media WHERE user_id = ? AND rating IS NOT NULL${hidden}`, [user.id]))?.n ?? 0;
  const friends = (await listUsers()).filter((u) => u.status !== "pending" && u.id !== user.id);

  return (
    <div className="space-y-12">
      <section className="flex flex-wrap items-center gap-5">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="size-20 rounded-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex size-20 items-center justify-center rounded-full bg-accent text-3xl font-bold text-on-accent">{pseudo.slice(0, 1).toUpperCase()}</span>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">{pseudo}</h1>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={mine ? "/bibliotheque" : `/bibliotheque?u=${user.id}`} className="link">Bibliothèque</Link>
            <Link href={mine ? "/stats" : `/stats?u=${user.id}`} className="link">Stats</Link>
            {mine && <Link href={`/wrapped/${year}`} className="link">Récap {year}</Link>}
            {mine && <Link href="/reglages" className="link">Réglages</Link>}
          </p>
        </div>
      </section>

      <section className="flex flex-wrap gap-x-10 gap-y-4">
        {KINDS.filter((k) => counts.some((c) => c.kind === k)).map((k) => {
          const c = counts.find((x) => x.kind === k)!;
          return (
            <div key={k}>
              <p className="text-3xl font-bold tabular-nums">{c.total}</p>
              <p className="text-sm text-muted">
                {(c.total > 1 ? KIND_PLURAL[k] : KIND_LABEL[k]).toLowerCase()}
                {c.thisYear ? ` · ${c.thisYear} en ${year}` : ""}
              </p>
            </div>
          );
        })}
        {ratingCount > 0 && (
          <div>
            <p className="text-3xl font-bold tabular-nums">{ratingCount}</p>
            <p className="text-sm text-muted">notes</p>
          </div>
        )}
      </section>

      {favs.length === 0 && (
        <p className="text-muted">
          {mine ? "Pas encore de favoris : choisis-les dans les Réglages, ou « Ajouter aux favoris » sur une fiche (le premier est couronné)." : "Pas encore de favoris."}
        </p>
      )}
      {favs.length > 0 && (
        <section>
          <h2 className="mb-4 text-xl font-semibold tracking-tight">Favoris</h2>
          <div className="flex flex-wrap items-end gap-3">
            {favs.map((m, i) => (
              <Link key={m.id} href={`/media/${m.id}`} title={m.title} className="w-[132px] sm:w-[160px]">
                {/* Couronne au-dessus du favori n°1, comme sur Backloggd. */}
                <p className="mb-1 h-5 text-center text-[#f0a33a]" aria-hidden>
                  {i === 0 ? (
                    <svg viewBox="0 0 24 24" className="mx-auto size-5 fill-current">
                      <path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7zm2 13h14v2H5z" />
                    </svg>
                  ) : null}
                </p>
                <Cover src={m.cover_grid || m.cover} title={m.title} className={i === 0 ? "ring-2 ring-[#f0a33a]" : ""} />
                {m.rating != null && (
                  <p className="mt-1">
                    <Stars value={m.rating} size={13} />
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {friends.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Le groupe</h2>
          <p className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {friends.map((f) => (
              <Link key={f.id} href={`/u/${f.id}`} className="inline-flex items-center gap-2 hover:text-fg">
                {f.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.avatar} alt="" className="size-6 rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : null}
                <span className="link">{f.name}</span>
              </Link>
            ))}
          </p>
        </section>
      )}
    </div>
  );
}
