"use client";

import { useState, useTransition } from "react";
import { saveFavorites, searchOwn } from "@/app/actions";
import { FAV_MAX, KIND_LABEL, type Kind } from "@/lib/kinds";
import { Cover } from "@/components/cover";

type Fav = { id: number; title: string; cover: string; kind: Kind };

const CROWN = "M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7zm2 13h14v2H5z";

// Favoris du profil, tous types confondus, comme sur Backloggd : glisser une couverture pour réordonner (flèches sur
// téléphone), × pour retirer, + pour ajouter depuis sa bibliothèque. Le premier porte la couronne.
export function FavoritesEditor({ initial }: { initial: Fav[] }) {
  const [favs, setFavs] = useState(initial);
  const [drag, setDrag] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Fav[] | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const commit = (next: Fav[]) => {
    const prev = favs;
    setFavs(next);
    start(async () => {
      const r = await saveFavorites(next.map((f) => f.id));
      if (!r.ok) {
        setFavs(prev);
        setErr(r.text);
      } else setErr("");
    });
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= favs.length || from === to) return;
    const next = [...favs];
    const [f] = next.splice(from, 1);
    next.splice(to, 0, f);
    commit(next);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {favs.map((f, i) => (
          <div
            key={f.id}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag != null) move(drag, i);
              setDrag(null);
            }}
            onDragEnd={() => setDrag(null)}
            className={`group relative cursor-grab active:cursor-grabbing ${drag === i ? "opacity-40" : ""}`}
            title={f.title}
          >
            <Cover src={f.cover} title={f.title} className={i === 0 ? "ring-2 ring-[#f0a33a]" : ""} />
            {i === 0 && (
              <svg viewBox="0 0 24 24" className="absolute -top-2.5 left-1/2 size-5 -translate-x-1/2 fill-[#f0a33a] drop-shadow" aria-label="Favori couronné">
                <path d={CROWN} />
              </svg>
            )}
            <button
              type="button"
              aria-label={`Retirer ${f.title}`}
              disabled={pending}
              onClick={() => commit(favs.filter((x) => x.id !== f.id))}
              className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/70 text-sm text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
            >
              ×
            </button>
            <div className="mt-1 flex items-center gap-1 text-[0.7rem] text-muted">
              <button type="button" aria-label="Plus tôt" disabled={pending || i === 0} onClick={() => move(i, i - 1)} className="px-1 disabled:opacity-30 sm:hidden">◀</button>
              <span className="min-w-0 flex-1 truncate">{KIND_LABEL[f.kind]}</span>
              <button type="button" aria-label="Plus tard" disabled={pending || i === favs.length - 1} onClick={() => move(i, i + 1)} className="px-1 disabled:opacity-30 sm:hidden">▶</button>
            </div>
          </div>
        ))}
        {favs.length < FAV_MAX && (
          <button
            type="button"
            onClick={() => setAdding(!adding)}
            className="flex aspect-[2/3] items-center justify-center rounded-md border border-dashed border-line text-2xl text-muted hover:border-fg/40 hover:text-fg"
            aria-label="Ajouter un favori"
          >
            +
          </button>
        )}
      </div>
      {adding && (
        <div className="max-w-md space-y-2 text-sm">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) start(async () => setHits((await searchOwn(q)).filter((h) => !favs.some((f) => f.id === h.id))));
            }}
          >
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titre dans ta bibliothèque" className="min-w-0 flex-1" autoFocus />
            <button className="btn-quiet" disabled={pending}>Chercher</button>
          </form>
          {hits && !hits.length && <p className="text-muted">Rien de tel dans ta bibliothèque.</p>}
          {hits && hits.length > 0 && (
            <ul className="divide-y divide-line">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 py-1.5 text-left hover:text-fg"
                    onClick={() => {
                      commit([...favs, h]);
                      setHits(null);
                      setQ("");
                      setAdding(false);
                    }}
                  >
                    <Cover src={h.cover} title="" className="w-7 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {h.title}
                      <span className="text-muted"> · {KIND_LABEL[h.kind]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="text-xs text-muted">
        {favs.length}/{FAV_MAX} · glisse les couvertures pour les réordonner ; la première est couronnée.
      </p>
      {err && <p className="text-sm text-danger">{err}</p>}
    </div>
  );
}
