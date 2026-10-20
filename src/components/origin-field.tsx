"use client";

import { useState, useTransition } from "react";
import { searchOwn } from "@/app/actions";
import { KIND_LABEL, RELATIONS, type Kind } from "@/lib/kinds";
import { Cover } from "@/components/cover";

type Hit = { id: number; title: string; kind: Kind; year: number | null; cover: string };

// Champ « Adaptation de… » : l'œuvre d'origine dans sa bibliothèque (input caché « parent ») et la relation (« relation »).
export function OriginField({ name = "parent", exclude }: { name?: string; exclude?: number }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [picked, setPicked] = useState<Hit | null>(null);
  const [pending, start] = useTransition();
  const find = () => {
    if (q.trim()) start(async () => setHits((await searchOwn(q)).filter((h) => h.id !== exclude)));
  };

  return (
    <div className="space-y-2 text-sm">
      <input type="hidden" name={name} value={picked?.id ?? ""} />
      {picked ? (
        <div className="flex flex-wrap items-center gap-3">
          <select name="relation" defaultValue="Adaptation" aria-label="Relation" className="w-44">
            {RELATIONS.map((r) => (
              <option key={r} value={r}>{r} de</option>
            ))}
          </select>
          <Cover src={picked.cover} title="" className="w-7 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {picked.title}
            <span className="text-muted"> · {KIND_LABEL[picked.kind]}</span>
          </span>
          <button type="button" className="btn-quiet text-xs" onClick={() => setPicked(null)}>Retirer</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // Entrée cherche au lieu d'envoyer le formulaire d'ajout.
              if (e.key === "Enter") {
                e.preventDefault();
                find();
              }
            }}
            placeholder="Titre de l’œuvre d’origine dans ta bibliothèque"
            className="min-w-0 flex-1"
          />
          <button type="button" className="btn-quiet" disabled={pending} onClick={find}>{pending ? "…" : "Chercher"}</button>
        </div>
      )}
      {!picked && hits && (
        hits.length ? (
          <ul className="max-h-56 divide-y divide-line overflow-y-auto">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-1.5 text-left hover:text-fg"
                  onClick={() => {
                    setPicked(h);
                    setHits(null);
                    setQ("");
                  }}
                >
                  <Cover src={h.cover} title="" className="w-7 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {h.title}
                    <span className="text-muted"> · {KIND_LABEL[h.kind]}{h.year ? ` · ${h.year}` : ""}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Rien de tel dans ta bibliothèque.</p>
        )
      )}
    </div>
  );
}
