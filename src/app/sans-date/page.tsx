import { connection } from "next/server";
import { all } from "@/lib/db";
import { requireUid } from "@/lib/user";
import { FinishList, type FinishRow } from "@/components/finish-list";

export const metadata = { title: "Fins à dater" };

// Fins importées sans date (AniList n'en a pas toujours) : à dater, même à l'année près, ou à marquer
// « inconnue » pour qu'elles cessent d'être signalées.
export default async function Undated() {
  await connection();
  const uid = await requireUid();
  const rows = await all<FinishRow>(
    `SELECT log.id AS log_id, media.id, media.title, media.cover, media.kind, log.finished_on, log.rewatch,
            COALESCE(log.rating, media.rating) AS rating
     FROM log JOIN media ON media.id = log.media_id
     WHERE media.user_id = ? AND log.finished_on IS NULL AND log.unknown = 0 ORDER BY media.kind, media.title`,
    [uid],
  );
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Fins à dater</h1>
      <p className="max-w-prose text-muted">
        Ces médias sont terminés mais sans date. Sélectionne-les pour leur donner un jour, un mois ou seulement une année ; ou
        « Inconnue » si tu ne sais plus : ils ne seront plus signalés. Les dates des fiches AniList y sont renvoyées.
      </p>
      {rows.length ? (
        <FinishList groups={[{ key: "a-dater", label: `${rows.length} à dater`, items: rows }]} startSelecting />
      ) : (
        <p className="text-muted">Tout est daté.</p>
      )}
    </div>
  );
}
