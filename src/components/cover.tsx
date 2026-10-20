import Link from "next/link";
import type { Media } from "@/lib/db";
import { KIND_COLOR, KIND_UNIT } from "@/lib/kinds";
import { RateButton } from "@/components/stars";
import { setRating } from "@/app/actions";

// Jaquette 2:3. Sans image, le titre tient lieu de couverture. Pas de Referer : certains hébergeurs
// (MangaDex, Letterboxd) refusent les images appelées depuis un autre site.
export function Cover({ src, title, className = "" }: { src: string; title: string; className?: string }) {
  return (
    <div className={`relative aspect-[2/3] overflow-hidden rounded-md bg-raised ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-muted">{title}</span>
      )}
    </div>
  );
}

export function MediaCard({ m, children }: { m: Media; children?: React.ReactNode }) {
  const unit = KIND_UNIT[m.kind];
  return (
    <div className="min-w-0">
      <Link href={`/media/${m.id}`} className="block">
        <Cover src={m.cover_grid || m.cover} title={m.title} />
        <p className="mt-2 line-clamp-2 text-sm leading-snug font-medium">{m.title}</p>
      </Link>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
        <span className="inline-block size-1.5 rounded-full" style={{ background: KIND_COLOR[m.kind] }} />
        {unit && m.status !== "termine" && (m.progress > 0 || m.total)
          ? `${m.progress}${m.total ? ` / ${m.total}` : ""} ${unit}${m.progress > 1 ? "s" : ""}`
          : m.year ?? ""}
      </p>
      {m.status === "termine" && (
        <div className="mt-1">
          <RateButton value={m.rating} action={setRating.bind(null, m.id)} size={15} />
        </div>
      )}
      {children}
    </div>
  );
}

export function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-5 lg:grid-cols-6">{children}</div>;
}
