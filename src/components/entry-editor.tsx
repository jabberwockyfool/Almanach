"use client";

import { useEffect, useState, useTransition } from "react";
import { addEntry, removeMedia, saveEntry, type Feedback } from "@/app/actions";
import type { SearchResult } from "@/lib/catalog";
import { KINDS, KIND_LABEL, KIND_UNIT, STATUSES, STATUS_LABEL, type Kind, type Status } from "@/lib/kinds";
import { DateFields } from "@/components/date-fields";
import { OriginField } from "@/components/origin-field";
import { StarField } from "@/components/stars";

const HEART = "M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2 0 3.6 1.1 5.3 3.1 1.7-2 3.3-3.1 5.3-3.1 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z";

// Suivi d'une fiche déjà dans la bibliothèque, pour le menu en mode modification.
export type Entry = {
  id: number;
  kind: Kind;
  title: string;
  subtitle: string;
  year: number | null;
  cover: string;
  status: Status;
  progress: number;
  total: number | null;
  rating: number | null;
  started_on: string | null;
  notes: string;
  liked: number;
  private: number;
};

// Menu de suivi façon AniList : bannière (ou couverture floutée), « j'aime » et Enregistrer en haut, puis le suivi.
//   result : ajout d'un résultat de recherche (ou d'une fiche d'un autre compte) ;
//   result null et pas d'entry : ajout à la main (titre, type, année… en plus) ;
//   entry : modification d'une fiche de sa bibliothèque (avec Supprimer).
export function EntryEditor({
  result,
  entry,
  banner,
  kind: manualKind,
  onClose,
  onAdded,
}: {
  result: SearchResult | null;
  entry?: Entry;
  banner?: string | null;
  kind: Kind;
  onClose: () => void;
  onAdded: (id: number, title: string) => void;
}) {
  const manual = result === null && !entry;
  const shown = entry ?? result;
  const [kind, setKind] = useState<Kind>(shown?.kind ?? manualKind);
  const [status, setStatus] = useState<Status>(entry?.status ?? "prevu");
  const [liked, setLiked] = useState(Boolean(entry?.liked));
  const [cover, setCover] = useState(shown?.cover ?? "");
  const [fb, setFb] = useState<Feedback | null>(null);
  const [pending, start] = useTransition();
  const unit = KIND_UNIT[kind];
  const total = shown?.total ?? null;
  // Date de fin demandée quand l'œuvre devient terminée (une fiche déjà terminée a son historique sur la page).
  const askFinish = status === "termine" && entry?.status !== "termine";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-6" onClick={onClose}>
      <form
        className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-xl bg-bg sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          start(async () => {
            const r = entry ? { ...(await saveEntry(entry.id, form)), id: entry.id, title: entry.title } : await addEntry(result, form);
            setFb(r);
            if (r.ok && r.id) onAdded(r.id, r.title ?? "");
          });
        }}
      >
        <input type="hidden" name="liked" value={liked ? "1" : ""} />
        <header className="relative overflow-hidden">
          {/* Bandeau : la bannière de l'œuvre, sinon sa couverture floutée et assombrie. */}
          <div className="absolute inset-0 bg-neutral-900">
            {banner ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={banner} alt="" className="size-full object-cover opacity-50" referrerPolicy="no-referrer" />
            ) : (
              cover && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt="" className="size-full scale-110 object-cover opacity-40 blur-xl" referrerPolicy="no-referrer" />
              )
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="absolute top-2 right-3 z-10 text-2xl leading-none text-white/70 hover:text-white">
            ×
          </button>
          <div className="relative flex items-end gap-4 px-5 pt-10 pb-4 sm:px-6 sm:pt-16">
            <div className="w-20 shrink-0 sm:w-24">
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt="" className="aspect-[2/3] w-full rounded-md object-cover shadow-lg" referrerPolicy="no-referrer" />
              ) : (
                <div className="aspect-[2/3] w-full rounded-md bg-line" />
              )}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              {manual ? (
                <input name="title" required placeholder="Titre" className="w-full text-lg font-semibold" autoFocus />
              ) : (
                <>
                  <h2 className="line-clamp-2 text-lg font-semibold text-white">{shown!.title}</h2>
                  <p className="truncate text-sm text-white/70">{[KIND_LABEL[kind], shown!.year, shown!.subtitle].filter(Boolean).join(" · ")}</p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setLiked(!liked)}
              aria-pressed={liked}
              title={liked ? "Je n’aime plus" : "J’aime"}
              className="mb-1 shrink-0 rounded p-1.5"
            >
              <svg viewBox="0 0 24 24" className={`size-6 ${liked ? "fill-like" : "fill-white/80 hover:fill-white"}`}>
                <path d={HEART} />
              </svg>
            </button>
            <button className="btn mb-1 shrink-0" disabled={pending}>{pending ? "…" : "Enregistrer"}</button>
          </div>
        </header>

        <div className="grid gap-x-5 gap-y-4 p-5 sm:grid-cols-3 sm:p-6">
          {manual && (
            <>
              <label>
                <span>Type</span>
                <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-full">
                  {KINDS.map((k) => (
                    <option key={k} value={k}>{KIND_LABEL[k]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Année</span>
                <input name="year" inputMode="numeric" className="w-full" />
              </label>
              <label>
                <span>Couverture (adresse)</span>
                <input name="cover" type="url" value={cover} onChange={(e) => setCover(e.target.value)} className="w-full" />
              </label>
              {kind === "roman" && (
                <>
                  <label>
                    <span>Auteur</span>
                    <input name="author" className="w-full" />
                  </label>
                  <label>
                    <span>ISBN</span>
                    <input name="isbn" inputMode="numeric" className="w-full" />
                  </label>
                </>
              )}
            </>
          )}

          <label>
            <span>Statut</span>
            <select name="status" value={status} onChange={(e) => setStatus(e.target.value as Status)} className="w-full">
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <span className="mb-1 block text-sm text-muted">Note</span>
            <StarField defaultValue={entry?.rating ?? null} />
          </div>

          {unit && status !== "termine" && (
            <label>
              <span>Progression ({unit}s)</span>
              <div className="flex items-center gap-2">
                <input name="progress" type="number" min={0} max={total ?? undefined} defaultValue={entry?.progress ?? 0} className="w-full" />
                {total ? <span className="shrink-0 text-sm text-muted">/ {total}</span> : null}
              </div>
            </label>
          )}
          {unit && !total && (
            <label>
              <span>Total ({unit}s)</span>
              <input name="total" type="number" min={1} className="w-full" />
            </label>
          )}
          <label>
            <span>Commencé le</span>
            <input name="started_on" type="date" defaultValue={entry?.started_on ?? ""} className="w-full" />
          </label>
          {askFinish && (
            <div className="sm:col-span-2">
              <span className="mb-1 block text-sm text-muted">Terminé le</span>
              <DateFields value={null} />
              <p className="mt-1 text-xs text-muted">Aujourd’hui : publié dans le fil d’activité. Une autre date : ajouté sans être publié.</p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" name="private" value="1" defaultChecked={Boolean(entry?.private)} />
            <p>
              Privé <span className="text-muted">: visible de toi seul, hors du fil des autres</span>
            </p>
          </label>
          <label className="sm:col-span-3">
            <span>Notes</span>
            <textarea name="notes" rows={2} defaultValue={entry?.notes ?? ""} className="w-full" />
          </label>
          {!entry && (
            <div className="sm:col-span-3">
              <span className="mb-1 block text-sm text-muted">Adaptation, remake, suite… de <span className="text-faint">(facultatif)</span></span>
              <OriginField />
            </div>
          )}

          {(fb?.text || entry) && (
            <div className="flex items-center gap-3 sm:col-span-3">
              {fb?.text && <p className={`text-sm ${fb.ok ? "text-muted" : "text-danger"}`}>{fb.text}</p>}
              {entry && (
                <button
                  type="button"
                  className="btn-quiet ml-auto text-xs"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Supprimer « ${entry.title} » et son historique ?`)) start(() => removeMedia(entry.id));
                  }}
                >
                  Supprimer
                </button>
              )}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
