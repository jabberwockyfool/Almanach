"use client";

import { useState, useTransition } from "react";
import { findMangadex, setMangadex } from "@/app/actions";

type Hit = { id: string; title: string; alt: string; year: number | null };

// Relie un manga à sa fiche MangaDex pour le lire dans l'appli.
export function MangadexLinker({ mediaId, title }: { mediaId: number; title: string }) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="text-sm">
      <button
        type="button"
        className="link text-muted"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await findMangadex(title);
            setHits(r.results);
            setError(r.error ?? "");
          })
        }
      >
        {pending ? "Recherche…" : "Lire dans l’appli : chercher sur MangaDex"}
      </button>
      {error && <p className="mt-2 text-danger">{error}</p>}
      {hits && !hits.length && <p className="mt-2 text-muted">Introuvable. Colle l’adresse de la fiche MangaDex dans les liens ci-dessus.</p>}
      {hits && hits.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {hits.map((h) => (
            <li key={h.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{h.title}</span>
                {h.year ? <span className="text-muted"> · {h.year}</span> : null}
                {h.alt && <span className="block truncate text-xs text-muted">{h.alt}</span>}
              </span>
              <button type="button" className="btn-quiet text-xs" onClick={() => start(async () => void (await setMangadex(mediaId, h.id)))}>
                Relier
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
