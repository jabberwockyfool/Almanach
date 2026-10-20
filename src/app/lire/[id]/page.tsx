import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { get, type Media } from "@/lib/db";
import { chapters, type Chapter } from "@/lib/mangadex";
import { readingLangs, uniqueChapters } from "@/lib/reading";
import { requireUid } from "@/lib/user";

export const metadata = { title: "Chapitres" };

export default async function Chapters({ params }: PageProps<"/lire/[id]">) {
  await connection();
  const uid = await requireUid();
  const id = Number((await params).id);
  const m = await get<Media>("SELECT * FROM media WHERE id = ? AND user_id = ?", [id, uid]);
  if (!m?.mangadex_id) notFound();
  const langs = await readingLangs(uid);
  let list: Chapter[] = [];
  let error = "";
  try {
    list = uniqueChapters(await chapters(m.mangadex_id, langs), langs);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const next = list.find((c) => Number(c.chapter) > m.progress);

  return (
    <div className="space-y-6">
      <p className="text-sm">
        <Link href={`/media/${m.id}`} className="text-muted hover:text-fg">← {m.title}</Link>
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Chapitres</h1>
        {next && (
          <Link href={`/lire/${m.id}/${next.id}`} className="btn">
            Reprendre au chapitre {next.chapter}
          </Link>
        )}
      </div>
      <p className="text-sm text-muted">
        Langues : {langs.join(", ")} (modifiable dans Réglages). Les chapitres absents de MangaDex (licenciés, hébergés ailleurs) n’apparaissent pas.
      </p>
      {error && <p className="text-danger">{error}</p>}
      {!error && !list.length && <p className="text-muted">Aucun chapitre lisible dans ces langues.</p>}
      <ul className="divide-y divide-line">
        {list.map((c) => {
          const read = Number(c.chapter) <= m.progress;
          return (
            <li key={c.id}>
              <Link href={`/lire/${m.id}/${c.id}`} className={`flex items-baseline gap-3 py-2.5 ${read ? "text-faint" : ""}`}>
                <span className="w-24 shrink-0 font-medium">Ch. {c.chapter ?? "?"}</span>
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="shrink-0 text-xs text-muted uppercase">{c.lang}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
