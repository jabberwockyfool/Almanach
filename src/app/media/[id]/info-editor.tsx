"use client";

import { useState, useTransition } from "react";
import { saveInfo, type Feedback, type InfoOverride } from "@/app/actions";

type Row = { label: string; value: string };
type Tag = { name: string; rank: number; spoiler: boolean };

// Infos de la colonne (Format, Chapitres, Auteur, Genres…) et tags, modifiables à la main. Préremplis avec ce
// qu'affichent les sources ; une fois enregistrés, ils les remplacent pour cette fiche.
export function InfoEditor({ mediaId, rows: initialRows, tags: initialTags, overridden }: { mediaId: number; rows: Row[]; tags: Tag[]; overridden: boolean }) {
  const [rows, setRows] = useState<Row[]>(initialRows.length ? initialRows : [{ label: "", value: "" }]);
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [fb, setFb] = useState<Feedback | null>(null);
  const [pending, start] = useTransition();
  const save = (data: InfoOverride | null) => start(async () => setFb(await saveInfo(mediaId, data)));
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setTag = (i: number, patch: Partial<Tag>) => setTags(tags.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  return (
    <div className="space-y-6 text-sm">
      <div className="space-y-2">
        <h3 className="font-medium">Infos</h3>
        <p className="text-xs text-muted">Une ligne par info, comme dans la colonne de gauche (« Chapitres » → « 58 », « Genres » → « Drame, Romance »).</p>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} placeholder="Libellé" aria-label="Libellé" className="w-40 shrink-0" />
            <input value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} placeholder="Valeur" aria-label="Valeur" className="min-w-0 flex-1" />
            <button type="button" aria-label="Retirer la ligne" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="btn-quiet px-2 text-xs">×</button>
          </div>
        ))}
        <button type="button" onClick={() => setRows([...rows, { label: "", value: "" }])} className="btn-quiet text-xs">+ Ligne</button>
      </div>

      <div className="space-y-2">
        <h3 className="font-medium">Tags</h3>
        {tags.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={t.name} onChange={(e) => setTag(i, { name: e.target.value })} placeholder="Tag" aria-label="Tag" className="min-w-0 flex-1" />
            <input
              type="number"
              min={0}
              max={100}
              value={t.rank}
              onChange={(e) => setTag(i, { rank: Number(e.target.value) })}
              aria-label="Pertinence en %"
              className="w-20"
            />
            <span className="text-muted">%</span>
            <label className="flex items-center gap-1 text-xs text-muted" title="Masqué jusqu'au clic, comme sur AniList">
              <input type="checkbox" checked={t.spoiler} onChange={(e) => setTag(i, { spoiler: e.target.checked })} />
              <p>spoiler</p>
            </label>
            <button type="button" aria-label="Retirer le tag" onClick={() => setTags(tags.filter((_, j) => j !== i))} className="btn-quiet px-2 text-xs">×</button>
          </div>
        ))}
        <button type="button" onClick={() => setTags([...tags, { name: "", rank: 50, spoiler: false }])} className="btn-quiet text-xs">+ Tag</button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() =>
            save({
              rows: rows.map((r) => ({ label: r.label.trim(), value: r.value.trim() })).filter((r) => r.label && r.value),
              tags: tags.map((t) => ({ ...t, name: t.name.trim() })).filter((t) => t.name),
            })
          }
        >
          {pending ? "…" : "Enregistrer les infos"}
        </button>
        {overridden && (
          <button type="button" className="btn-quiet text-xs" disabled={pending} onClick={() => save(null)}>
            Revenir aux infos des sources
          </button>
        )}
        {fb?.text && <span className={fb.ok ? "text-muted" : "text-danger"}>{fb.text}</span>}
      </div>
    </div>
  );
}
