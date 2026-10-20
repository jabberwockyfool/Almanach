"use client";

import { useState, useTransition } from "react";
import { findCovers, setCover } from "@/app/actions";
import { Cover } from "@/components/cover";

// Réduit une image envoyée à 600 px de large (JPEG) avant de la garder dans la base.
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 600 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

// La jaquette de la fiche ; un clic ouvre le choix d'une autre couverture.
export function CoverEditor({ mediaId, cover, title }: { mediaId: number; cover: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const apply = (value: string) =>
    start(async () => {
      const r = await setCover(mediaId, value);
      setMsg(r.ok ? "" : r.text);
      if (r.ok) setOpen(false);
    });

  return (
    <div className="w-full">
      <button type="button" onClick={() => setOpen((v) => !v)} className="group relative block w-full" aria-label="Changer la couverture">
        <Cover src={cover} title={title} />
        <span className="absolute inset-x-0 bottom-0 rounded-b-md bg-black/60 py-1 text-center text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Changer
        </span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={() => setOpen(false)}>
          <div
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-bg p-5 sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-semibold">Couverture</h2>
              <button type="button" className="text-sm text-muted" onClick={() => setOpen(false)}>Fermer</button>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim()) apply(url);
              }}
            >
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Adresse d’une image" className="min-w-0 flex-1" />
              <button className="btn" disabled={pending}>OK</button>
            </form>
            <label className="mt-4 block text-sm">
              <span>Ou une image de ton appareil</span>
              <input
                type="file"
                accept="image/*"
                className="w-full"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) apply(await shrink(f));
                }}
              />
            </label>
            <div className="mt-5">
              {candidates === null ? (
                <button
                  type="button"
                  className="link text-sm text-muted"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await findCovers(mediaId);
                      setCandidates(r.covers);
                      setMsg(r.error ?? "");
                    })
                  }
                >
                  {pending ? "Recherche…" : "Voir d’autres couvertures"}
                </button>
              ) : candidates.length ? (
                <div className="grid grid-cols-4 gap-2">
                  {candidates.map((c) => (
                    <button key={c} type="button" onClick={() => apply(c)} disabled={pending}>
                      <Cover src={c} title="" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">Aucune autre couverture trouvée.</p>
              )}
            </div>
            {cover && (
              <button type="button" className="mt-5 text-sm text-muted link" onClick={() => apply("")} disabled={pending}>
                Retirer la couverture
              </button>
            )}
            {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
