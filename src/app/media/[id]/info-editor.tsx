"use client";

import { useState, useTransition } from "react";
import { saveInfo, type Feedback, type InfoOverride } from "@/app/actions";

type Row = { label: string; value: string };
type Tag = { name: string; rank: number; spoiler: boolean };
type Character = { name: string; role: string; image: string; va?: { name: string; image: string } };
type Section = "rows" | "tags" | "description" | "characters";

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="font-medium">{children}</h3>;
}

// Résumé, infos de la colonne (Format, Chapitres, Auteur, Genres…), tags et personnages, modifiables à la main.
// Préremplis avec ce qu'affichent les sources ; seules les sections modifiées sont enregistrées (elles remplacent
// alors celles des sources pour cette fiche), les autres continuent de suivre les sources.
export function InfoEditor({
  mediaId,
  rows: initialRows,
  tags: initialTags,
  description: initialDescription,
  characters: initialCharacters,
  overridden,
}: {
  mediaId: number;
  rows: Row[];
  tags: Tag[];
  description: string;
  characters: Character[];
  overridden: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(initialRows.length ? initialRows : [{ label: "", value: "" }]);
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [description, setDescription] = useState(initialDescription);
  const [characters, setCharacters] = useState<Character[]>(initialCharacters);
  const [dirty, setDirty] = useState<Set<Section>>(new Set());
  const [fb, setFb] = useState<Feedback | null>(null);
  const [pending, start] = useTransition();
  const touch = (s: Section) => setDirty((d) => new Set(d).add(s));
  const save = (data: InfoOverride | null) =>
    start(async () => {
      const r = await saveInfo(mediaId, data);
      setFb(r);
      if (r.ok) setDirty(new Set());
    });
  const setRow = (i: number, patch: Partial<Row>) => (touch("rows"), setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))));
  const setTag = (i: number, patch: Partial<Tag>) => (touch("tags"), setTags(tags.map((t, j) => (j === i ? { ...t, ...patch } : t))));
  const setChar = (i: number, patch: Partial<Character>) => (touch("characters"), setCharacters(characters.map((c, j) => (j === i ? { ...c, ...patch } : c))));

  const payload = (): InfoOverride => ({
    ...(dirty.has("rows") && { rows: rows.map((r) => ({ label: r.label.trim(), value: r.value.trim() })).filter((r) => r.label && r.value) }),
    ...(dirty.has("tags") && { tags: tags.map((t) => ({ ...t, name: t.name.trim() })).filter((t) => t.name) }),
    ...(dirty.has("description") && { description }),
    ...(dirty.has("characters") && { characters: characters.filter((c) => c.name.trim()) }),
  });

  return (
    <div className="space-y-8 text-sm">
      <div className="space-y-2">
        <H>Résumé</H>
        <textarea
          value={description}
          onChange={(e) => (touch("description"), setDescription(e.target.value))}
          rows={6}
          placeholder="Résumé de l’œuvre"
          className="w-full"
        />
      </div>

      <div className="space-y-2">
        <H>Infos</H>
        <p className="text-xs text-muted">Une ligne par info, comme dans la colonne de gauche (« Chapitres » → « 58 », « Genres » → « Drame, Romance »).</p>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} placeholder="Libellé" aria-label="Libellé" className="w-40 shrink-0" />
            <input value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} placeholder="Valeur" aria-label="Valeur" className="min-w-0 flex-1" />
            <button type="button" aria-label="Retirer la ligne" onClick={() => (touch("rows"), setRows(rows.filter((_, j) => j !== i)))} className="btn-quiet px-2 text-xs">×</button>
          </div>
        ))}
        <button type="button" onClick={() => (touch("rows"), setRows([...rows, { label: "", value: "" }]))} className="btn-quiet text-xs">+ Ligne</button>
      </div>

      <div className="space-y-2">
        <H>Tags</H>
        {tags.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={t.name} onChange={(e) => setTag(i, { name: e.target.value })} placeholder="Tag" aria-label="Tag" className="min-w-0 flex-1" />
            <input type="number" min={0} max={100} value={t.rank} onChange={(e) => setTag(i, { rank: Number(e.target.value) })} aria-label="Pertinence en %" className="w-20" />
            <span className="text-muted">%</span>
            <label className="flex items-center gap-1 text-xs text-muted" title="Masqué jusqu'au clic, comme sur AniList">
              <input type="checkbox" checked={t.spoiler} onChange={(e) => setTag(i, { spoiler: e.target.checked })} />
              <p>spoiler</p>
            </label>
            <button type="button" aria-label="Retirer le tag" onClick={() => (touch("tags"), setTags(tags.filter((_, j) => j !== i)))} className="btn-quiet px-2 text-xs">×</button>
          </div>
        ))}
        <button type="button" onClick={() => (touch("tags"), setTags([...tags, { name: "", rank: 50, spoiler: false }]))} className="btn-quiet text-xs">+ Tag</button>
      </div>

      <div className="space-y-2">
        <H>Personnages</H>
        <p className="text-xs text-muted">Nom, rôle (Principal, Secondaire…), image (adresse), et au besoin le doubleur ou l’acteur.</p>
        {characters.map((c, i) => (
          <div key={i} className="flex gap-3 rounded-md bg-raised p-2">
            {c.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.image} alt="" referrerPolicy="no-referrer" className="h-16 w-12 shrink-0 rounded object-cover" />
            ) : (
              <span className="h-16 w-12 shrink-0 rounded bg-line" />
            )}
            <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2">
              <input value={c.name} onChange={(e) => setChar(i, { name: e.target.value })} placeholder="Nom" aria-label="Nom du personnage" />
              <input value={c.role} onChange={(e) => setChar(i, { role: e.target.value })} placeholder="Rôle" aria-label="Rôle" />
              <input value={c.image} onChange={(e) => setChar(i, { image: e.target.value })} placeholder="Image (adresse)" aria-label="Image du personnage" className="sm:col-span-2" />
              <input
                value={c.va?.name ?? ""}
                onChange={(e) => setChar(i, { va: { name: e.target.value, image: c.va?.image ?? "" } })}
                placeholder="Doubleur / acteur"
                aria-label="Doubleur"
              />
              <input
                value={c.va?.image ?? ""}
                onChange={(e) => setChar(i, { va: { name: c.va?.name ?? "", image: e.target.value } })}
                placeholder="Image du doubleur"
                aria-label="Image du doubleur"
              />
            </div>
            <button type="button" aria-label="Retirer le personnage" onClick={() => (touch("characters"), setCharacters(characters.filter((_, j) => j !== i)))} className="btn-quiet self-start px-2 text-xs">×</button>
          </div>
        ))}
        <button type="button" onClick={() => (touch("characters"), setCharacters([...characters, { name: "", role: "Principal", image: "" }]))} className="btn-quiet text-xs">
          + Personnage
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn" disabled={pending || !dirty.size} onClick={() => save(payload())}>
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
