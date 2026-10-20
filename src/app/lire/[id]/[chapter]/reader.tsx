"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readChapter } from "@/app/actions";

// Lecture verticale (défilement continu). Arriver en bas du chapitre le compte comme lu.
export function Reader({
  mediaId,
  chapter,
  pages,
  prevHref,
  nextHref,
}: {
  mediaId: number;
  chapter: number;
  pages: string[];
  prevHref: string | null;
  nextHref: string | null;
}) {
  const end = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    const el = end.current;
    if (!el || !chapter) return;
    let sent = false;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !sent) {
        sent = true;
        readChapter(mediaId, chapter).then((r) => setSaved(r.text ? `Progression : ${r.text}` : ""));
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [mediaId, chapter]);

  return (
    <div className="mx-auto max-w-3xl">
      {pages.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt={`Page ${i + 1}`} referrerPolicy="no-referrer" loading={i < 3 ? "eager" : "lazy"} className="block w-full" />
      ))}
      <div ref={end} className="flex flex-col items-center gap-4 px-4 py-16 text-sm text-neutral-300">
        {saved && <p>{saved}</p>}
        <div className="flex gap-6">
          {prevHref && <Link href={prevHref} className="hover:text-white">← Précédent</Link>}
          {nextHref ? (
            <Link href={nextHref} className="rounded-full bg-white px-5 py-2 font-semibold text-black">Chapitre suivant</Link>
          ) : (
            <span>Dernier chapitre disponible</span>
          )}
        </div>
      </div>
    </div>
  );
}
