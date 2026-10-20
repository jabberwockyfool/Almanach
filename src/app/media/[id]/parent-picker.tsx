"use client";

import { useState, useTransition } from "react";
import { searchOwn, setParent, setRelation, type Feedback } from "@/app/actions";
import { KIND_LABEL, RELATIONS, type Kind } from "@/lib/kinds";
import { Cover } from "@/components/cover";

type Hit = { id: number; title: string; kind: Kind; year: number | null; cover: string };

// Recherche dans sa bibliothèque puis un bouton par résultat.
function OwnSearch({ placeholder, action, exclude, onPick }: { placeholder: string; action: string; exclude: number; onPick: (h: Hit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) start(async () => setHits((await searchOwn(q)).filter((h) => h.id !== exclude)));
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1" />
        <button className="btn-quiet" disabled={pending}>{pending ? "…" : "Chercher"}</button>
      </form>
      {hits && !hits.length && <p className="text-muted">Rien de tel dans ta bibliothèque.</p>}
      {hits && hits.length > 0 && (
        <ul className="max-w-md divide-y divide-line">
          {hits.map((h) => (
            <li key={h.id} className="flex items-center gap-3 py-1.5">
              <Cover src={h.cover} title="" className="w-7 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {h.title}
                <span className="text-muted"> · {KIND_LABEL[h.kind]}{h.year ? ` · ${h.year}` : ""}</span>
              </span>
              <button
                type="button"
                className="btn-quiet text-xs"
                onClick={() => {
                  onPick(h);
                  setHits(null);
                  setQ("");
                }}
              >
                {action}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Liens faits à la main, dans les deux sens : cette fiche se rattache à une autre (elle se range dessous dans la
// grille), ou une autre fiche se rattache à celle-ci, avec la relation choisie (Adaptation, Remake, Suite…).
// Le rangement automatique (relations AniList, VNDB, titres) reste la valeur par défaut.
export function ParentPicker({
  mediaId,
  override,
  relation,
  current,
}: {
  mediaId: number;
  override: number | null;
  relation: string | null;
  current: { id: number; title: string } | null;
}) {
  const [fb, setFb] = useState<Feedback | null>(null);
  const [pending, start] = useTransition();
  // Relation pour les prochains liens ; celle du lien actuel se change à part.
  const [rel, setRel] = useState<string>("Adaptation");
  const apply = (child: number, parent: number | null, r: string | null = null) => start(async () => setFb(await setParent(child, parent, r)));

  return (
    <div className="space-y-6 text-sm">
      <div className="space-y-3">
        <h3 className="font-medium">Cette œuvre est rattachée à…</h3>
        <p className="text-muted">
          {override === 0
            ? "Aucune : affichée seule dans la grille (rangement automatique désactivé)."
            : override
              ? <>Choisi à la main : <span className="text-fg">{current?.title ?? "une autre fiche"}</span>.</>
              : current
                ? <>Trouvé automatiquement : <span className="text-fg">{current.title}</span>.</>
                : "Aucune œuvre d’origine trouvée automatiquement."}
        </p>
        {current && override !== 0 && (
          <label className="flex max-w-md items-center gap-2">
            <p className="shrink-0 text-muted">Relation :</p>
            <select
              defaultValue={relation ?? ""}
              disabled={pending}
              onChange={(e) => start(async () => setFb(await setRelation(mediaId, e.target.value || null)))}
              className="min-w-0 flex-1"
            >
              <option value="">Déduite automatiquement</option>
              {RELATIONS.map((r) => (
                <option key={r} value={r}>{r} de {current.title}</option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          {override !== null && (
            <button type="button" className="btn-quiet text-xs" disabled={pending} onClick={() => apply(mediaId, null)}>Revenir à l’automatique</button>
          )}
          {override !== 0 && (
            <button type="button" className="btn-quiet text-xs" disabled={pending} onClick={() => apply(mediaId, 0)}>Ne la rattacher à rien</button>
          )}
        </div>
      </div>
      <div className="space-y-3">
        <label className="flex max-w-md items-center gap-2">
          <p className="shrink-0 text-muted">Nouveau lien :</p>
          <select value={rel} onChange={(e) => setRel(e.target.value)} className="min-w-0 flex-1">
            {RELATIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <div className="space-y-2">
          <p className="text-muted">Cette œuvre est un(e) <span className="text-fg">{rel.toLowerCase()}</span> de…</p>
          <OwnSearch placeholder="Œuvre d’origine (titre dans ta bibliothèque)" action="Choisir" exclude={mediaId} onPick={(h) => apply(mediaId, h.id, rel)} />
        </div>
        <div className="space-y-2">
          <p className="text-muted">Ajouter un(e) <span className="text-fg">{rel.toLowerCase()}</span> de cette œuvre :</p>
          <OwnSearch placeholder="Titre dans ta bibliothèque" action="Ajouter" exclude={mediaId} onPick={(h) => apply(h.id, mediaId, rel)} />
        </div>
      </div>
      {fb?.text && <p className={fb.ok ? "text-muted" : "text-danger"}>{fb.text}</p>}
    </div>
  );
}
