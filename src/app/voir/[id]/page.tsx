import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { get, type Link as MediaLink, type Media } from "@/lib/db";
import { KIND_UNIT } from "@/lib/kinds";
import { requireUid } from "@/lib/user";
import { ActionButton } from "@/components/action-button";
import { stepProgress } from "@/app/actions";

export const metadata = { title: "Visionneuse" };

// Ouvre un lien « où regarder / lire » dans l'appli, avec la progression à portée de main.
// Beaucoup de plateformes (Netflix, Crunchyroll…) interdisent l'intégration : la page reste alors blanche,
// d'où le lien « nouvel onglet » toujours visible.
export default async function Viewer({ params }: PageProps<"/voir/[id]">) {
  await connection();
  const uid = await requireUid();
  const link = await get<MediaLink>("SELECT * FROM link WHERE id = ?", [Number((await params).id)]);
  if (!link) notFound();
  const m = await get<Media>("SELECT * FROM media WHERE id = ? AND user_id = ?", [link.media_id, uid]);
  if (!m) notFound();
  const unit = KIND_UNIT[m.kind];
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="flex items-center gap-3 border-b border-line px-3 py-2 text-sm">
        <Link href={`/media/${m.id}`} className="shrink-0 text-muted hover:text-fg">← Retour</Link>
        <span className="min-w-0 flex-1 truncate font-medium">
          {m.title}
          {unit && <span className="ml-2 text-muted">{m.progress}{m.total ? ` / ${m.total}` : ""}</span>}
        </span>
        {unit && m.status !== "termine" && (
          <ActionButton action={stepProgress.bind(null, m.id, 1)} className="text-xs">+1 {unit}</ActionButton>
        )}
        <a href={link.url} target="_blank" rel="noreferrer" className="shrink-0 text-muted link">Nouvel onglet</a>
      </div>
      <iframe
        src={link.url}
        title={link.label}
        className="w-full flex-1 border-0 bg-white"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write"
        allowFullScreen
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
