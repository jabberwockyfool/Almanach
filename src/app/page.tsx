import Link from "next/link";
import { connection } from "next/server";
import { all, get, type Media } from "@/lib/db";
import { KIND_UNIT, formatDate } from "@/lib/kinds";
import { PageField } from "@/components/page-field";
import { requireUser } from "@/lib/user";
import { Cover, MediaCard } from "@/components/cover";
import { ActionButton } from "@/components/action-button";
import { stepProgress } from "@/app/actions";
import { ActivityFeed } from "@/components/activity-feed";
import { withCovers } from "@/lib/prefs";

export default async function Home() {
  await connection();
  const user = await requireUser();
  const uid = user.id;
  const year = new Date().getFullYear();
  const current = await withCovers(await all<Media>("SELECT * FROM media WHERE user_id = ? AND status = 'en_cours' ORDER BY updated_at DESC", [uid]));
  const recent = await withCovers(await all<Media & { finished_on: string }>(
    `SELECT media.*, log.finished_on FROM log JOIN media ON media.id = log.media_id
     WHERE media.user_id = ? AND log.finished_on IS NOT NULL ORDER BY log.finished_on DESC, log.id DESC LIMIT 12`,
    [uid],
  ));
  const count = await get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM log JOIN media ON media.id = log.media_id WHERE media.user_id = ? AND log.finished_on LIKE ?",
    [uid, `${year}%`],
  );
  const empty = !current.length && !recent.length;

  return (
    // Grand écran : fil d'activité à gauche (colonne fixe), contenu élargi et centré dans le reste.
    <div className="min-[1700px]:grid min-[1700px]:grid-cols-[minmax(320px,380px)_1fr] min-[1700px]:gap-12">
      <div className="mx-auto w-full max-w-6xl space-y-12 min-[1700px]:order-2 min-[1700px]:max-w-[1500px]">
        <section className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight min-[1700px]:text-3xl">
            {count?.n ?? 0} terminé{(count?.n ?? 0) > 1 ? "s" : ""} en {year}
          </h1>
          <p className="flex gap-4 text-sm">
            <Link href={`/annee/${year}`} className="link">
              Calendrier
            </Link>
            <Link href={`/wrapped/${year}`} className="link">
              Récap {year}
            </Link>
          </p>
        </section>

        {empty && (
          <p className="max-w-prose text-muted">
            Rien pour l’instant. <Link href="/ajouter" className="link text-fg">Ajoute un média</Link> ou relie tes comptes AniList,
            Letterboxd et Backloggd dans les <Link href="/reglages" className="link text-fg">réglages</Link>.
          </p>
        )}

        {current.length > 0 && (
          <section>
            <h2 className="mb-4 text-sm font-semibold tracking-wide text-muted uppercase">En cours</h2>
            <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-5 lg:grid-cols-6 min-[1700px]:grid-cols-7 min-[1700px]:gap-x-4">
              {current.map((m) => (
                <MediaCard key={m.id} m={m}>
                  {m.kind === "roman" ? (
                    <PageField m={m} compact />
                  ) : KIND_UNIT[m.kind] && (
                    <ActionButton quiet action={stepProgress.bind(null, m.id, 1)} className="mt-2 text-xs">
                      +1 {KIND_UNIT[m.kind]}
                    </ActionButton>
                  )}
                </MediaCard>
              ))}
            </div>
          </section>
        )}

        {recent.length > 0 && (
          <section>
            <h2 className="mb-4 text-sm font-semibold tracking-wide text-muted uppercase">Terminés récemment</h2>
            <ul className="divide-y divide-line">
              {recent.map((m, i) => (
                <li key={`${m.id}-${i}`}>
                  <Link href={`/media/${m.id}`} className="flex items-center gap-3 py-2.5">
                    <Cover src={m.cover_grid || m.cover} title="" className="w-9 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{m.title}</span>
                    <span className="shrink-0 text-sm text-muted">{formatDate(m.finished_on)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <ActivityFeed />
    </div>
  );
}
