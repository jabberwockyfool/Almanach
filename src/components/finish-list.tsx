"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { KIND_COLOR, KIND_LABEL, type Kind } from "@/lib/kinds";
import { bulkLogDate, type Feedback } from "@/app/actions";
import { Cover } from "@/components/cover";
import { Stars } from "@/components/stars";
import { DateFields } from "@/components/date-fields";

export type FinishRow = {
  log_id: number;
  id: number;
  title: string;
  cover: string;
  kind: Kind;
  finished_on: string | null;
  rewatch: number;
  rating: number | null;
};

export type FinishGroup = { key: string; label: string; items: FinishRow[] };

// Liste des fins (calendrier, fins à dater) avec un mode sélection pour corriger les dates d'un coup :
// jour, mois, année seule ou inconnue.
export function FinishList({ groups, startSelecting = false }: { groups: FinishGroup[]; startSelecting?: boolean }) {
  const [selecting, setSelecting] = useState(startSelecting);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fb, setFb] = useState<Feedback | null>(null);
  const [pending, start] = useTransition();
  const all = groups.flatMap((g) => g.items);

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-8">
      <p className="flex flex-wrap items-center gap-3 text-sm">
        {selecting ? (
          <>
            <button type="button" className="link" onClick={() => setSelected(new Set(all.map((r) => r.log_id)))}>Tout sélectionner</button>
            <button type="button" className="link" onClick={() => setSelected(new Set())}>Aucun</button>
            <button type="button" className="link" onClick={() => { setSelecting(false); setSelected(new Set()); }}>Terminer</button>
          </>
        ) : (
          <button type="button" className="link text-muted" onClick={() => setSelecting(true)}>Corriger des dates</button>
        )}
      </p>

      {groups.map((g) => (
        <div key={g.key} id={g.key} className="scroll-mt-6">
          <h2 className="mb-2 flex items-center gap-3 text-sm font-semibold tracking-wide text-muted uppercase">
            {g.label}
            {selecting && (
              <button
                type="button"
                className="text-xs font-normal normal-case link"
                onClick={() => setSelected((s) => new Set([...s, ...g.items.map((r) => r.log_id)]))}
              >
                tout le groupe
              </button>
            )}
          </h2>
          <ul className="divide-y divide-line">
            {g.items.map((f) => {
              const day = f.finished_on && f.finished_on.length === 10 ? String(Number(f.finished_on.slice(8))) : "—";
              const row = (
                <>
                  <span className="w-6 shrink-0 text-right text-sm text-muted">{day}</span>
                  <Cover src={f.cover} title="" className="w-8 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {f.title}
                    {f.rewatch ? <span className="text-muted"> · revu</span> : null}
                  </span>
                  {f.rating != null && <Stars value={f.rating} size={12} />}
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                    <span className="inline-block size-1.5 rounded-full" style={{ background: KIND_COLOR[f.kind] }} />
                    <span className="hidden sm:inline">{KIND_LABEL[f.kind]}</span>
                  </span>
                </>
              );
              return (
                <li key={f.log_id} id={f.finished_on ? `jour-${f.finished_on}` : undefined} className="scroll-mt-6">
                  {selecting ? (
                    <label className={`flex cursor-pointer items-center gap-3 py-2 ${selected.has(f.log_id) ? "bg-accent/10" : ""}`}>
                      <input type="checkbox" checked={selected.has(f.log_id)} onChange={() => toggle(f.log_id)} className="size-4 shrink-0" />
                      {row}
                    </label>
                  ) : (
                    <Link href={`/media/${f.id}`} className="flex items-center gap-3 py-2">
                      {row}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {selecting && (
        <form
          className="fixed inset-x-0 bottom-14 z-40 border-t border-line bg-bg/95 backdrop-blur sm:bottom-0"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            start(async () => {
              const r = await bulkLogDate([...selected], data);
              setFb(r);
              if (r.ok) setSelected(new Set());
            });
          }}
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 text-sm sm:px-6">
            <span className="font-semibold">{selected.size} sélectionnée{selected.size > 1 ? "s" : ""}</span>
            <DateFields value={null} defaultPrecision="annee" />
            <button className="btn" disabled={pending || !selected.size}>{pending ? "…" : "Appliquer"}</button>
            {fb?.text && <span className={fb.ok ? "text-muted" : "text-danger"}>{fb.text}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
