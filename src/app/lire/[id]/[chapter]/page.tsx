import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { get, type Media } from "@/lib/db";
import { chapterPages, chapters } from "@/lib/mangadex";
import { readingLangs, uniqueChapters } from "@/lib/reading";
import { requireUid } from "@/lib/user";
import { Reader } from "./reader";

export const metadata = { title: "Lecture" };

export default async function ChapterPage({ params }: PageProps<"/lire/[id]/[chapter]">) {
  await connection();
  const uid = await requireUid();
  const { id, chapter } = await params;
  const m = await get<Media>("SELECT * FROM media WHERE id = ? AND user_id = ?", [Number(id), uid]);
  if (!m?.mangadex_id) notFound();
  const langs = await readingLangs(uid);
  const [pages, list] = await Promise.all([chapterPages(chapter), chapters(m.mangadex_id, langs)]);
  const ordered = uniqueChapters(list, langs);
  const index = ordered.findIndex((c) => c.id === chapter);
  const current = ordered[index] ?? list.find((c) => c.id === chapter);
  const next = index >= 0 ? ordered[index + 1] : undefined;
  const prev = index > 0 ? ordered[index - 1] : undefined;

  return (
    <div className="min-h-dvh bg-black">
      <div className="sticky top-0 z-10 flex items-center gap-3 bg-black/85 px-3 py-2 text-sm text-neutral-300 backdrop-blur">
        <Link href={`/lire/${m.id}`} className="shrink-0 hover:text-white">← Chapitres</Link>
        <span className="min-w-0 flex-1 truncate text-center">
          {m.title} · ch. {current?.chapter ?? "?"}
        </span>
        {next ? <Link href={`/lire/${m.id}/${next.id}`} className="shrink-0 hover:text-white">Suivant →</Link> : <span />}
      </div>
      <Reader
        mediaId={m.id}
        chapter={Number(current?.chapter ?? 0)}
        pages={pages}
        prevHref={prev ? `/lire/${m.id}/${prev.id}` : null}
        nextHref={next ? `/lire/${m.id}/${next.id}` : null}
      />
    </div>
  );
}
