"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { Media } from "@/lib/db";
import type { SeriesInfo } from "@/lib/groups";
import {
  FORMAT_LABEL, KIND_LABEL, KIND_UNIT, SORTS, STATUSES, STATUS_LABEL, THEN_SORTS, type Sort, type Status, type ThenSort,
} from "@/lib/kinds";
import { RateButton, Stars } from "@/components/stars";
import { bulkDelete, bulkStatus, setRating, type Feedback } from "@/app/actions";

const TABS: (Status | null)[] = [null, ...STATUSES];

type Item = Media & { last_finish?: string | null };

function TileCover({ m, label }: { m: Media; label?: string }) {
  const unit = KIND_UNIT[m.kind];
  const progress = unit && m.status !== "termine" && m.total ? Math.min(1, m.progress / m.total) : null;
  return (
    <div className="relative aspect-[2/3] overflow-hidden rounded-[4px] bg-raised ring-1 ring-fg/10">
      {m.cover_grid || m.cover ? (
        // Grille : couverture MAL pour les anime (avec le logo) quand elle est connue, sinon celle de la fiche.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.cover_grid || m.cover} alt={label ?? m.title} loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center p-1.5 text-center text-[0.7rem] leading-tight text-muted">{label ?? m.title}</span>
      )}
      {progress != null && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
          <span className="block h-full bg-star" style={{ width: `${progress * 100}%` }} />
        </span>
      )}
    </div>
  );
}

// Icônes sous les étoiles, comme sur Backloggd : critique (ou notes) et cœur.
function Marks({ m }: { m: Media }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {(m.review.trim() || m.notes.trim()) && (
        <svg viewBox="0 0 16 16" className="size-3 fill-muted" role="img" aria-label="Critique">
          <title>Critique</title>
          <path d="M2 3h12v1.5H2zm0 4h12v1.5H2zm0 4h8v1.5H2z" />
        </svg>
      )}
      {m.liked ? (
        <svg viewBox="0 0 24 24" className="size-3.5 fill-like" role="img" aria-label="Aimé">
          <title>Aimé</title>
          <path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2 0 3.6 1.1 5.3 3.1 1.7-2 3.3-3.1 5.3-3.1 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z" />
        </svg>
      ) : null}
    </span>
  );
}

const formatLabel = (k: Media) => FORMAT_LABEL[k.format ?? ""] ?? KIND_LABEL[k.kind];

// Carte de survol : note, « j'aime », critique et notes (les notes seulement dans sa propre bibliothèque).
function Details({ m, title, editable }: { m: Media; title: string; editable: boolean }) {
  const notes = editable ? m.notes.trim() : "";
  return (
    <div className="w-[300px] space-y-2 rounded-md border border-line bg-raised p-3 text-sm shadow-2xl shadow-black/50">
      <p className="leading-snug font-semibold">{title}</p>
      {(m.rating != null || Boolean(m.liked)) && (
        <p className="flex items-center gap-2">
          {m.rating != null && <Stars value={m.rating} size={14} />}
          {m.rating != null && <span className="text-xs text-muted tabular-nums">{m.rating.toLocaleString("fr-FR")}/10</span>}
          {m.liked ? <span className="text-like">♥</span> : null}
        </p>
      )}
      {m.review.trim() && (
        <div>
          <p className="text-xs font-semibold text-muted">Critique</p>
          <p className="line-clamp-[12] whitespace-pre-line text-muted">{m.review}</p>
        </div>
      )}
      {notes && (
        <div>
          <p className="text-xs font-semibold text-muted">Notes</p>
          <p className="line-clamp-6 whitespace-pre-line text-muted">{notes}</p>
        </div>
      )}
    </div>
  );
}

// Les adaptations d'une œuvre (anime, manga…), chacune suivie de ses films, OAV et spéciaux.
function Adaptations({ root, kids, parentOf }: { root: number; kids: Item[]; parentOf: Record<number, number> }) {
  const ids = new Set(kids.map((k) => k.id));
  const top = kids.filter((k) => parentOf[k.id] === root || !ids.has(parentOf[k.id]));
  const subOf = (id: number): Item[] => kids.filter((k) => parentOf[k.id] === id).flatMap((k) => [k, ...subOf(k.id)]);
  return (
    <div className="rounded-md border border-line bg-raised p-3 shadow-2xl shadow-black/50">
      <p className="mb-2 text-xs font-semibold text-muted">Adaptation{top.length > 1 ? "s" : ""}</p>
      <div className="flex flex-wrap gap-4">
        {top.map((k) => {
          const subs = subOf(k.id);
          return (
            <div key={k.id} className="flex gap-2">
              <Link href={`/media/${k.id}`} title={k.title} className="w-[92px] shrink-0">
                <TileCover m={k} />
                <p className="mt-1 truncate text-[0.7rem] text-muted">{formatLabel(k)}</p>
                {k.rating != null ? <Stars value={k.rating} size={11} /> : <p className="text-[0.65rem] text-faint">{STATUS_LABEL[k.status]}</p>}
              </Link>
              {subs.length > 0 && (
                <div className="flex w-[124px] flex-wrap content-start gap-1.5 border-l border-line pl-2">
                  {subs.map((s) => (
                    <Link key={s.id} href={`/media/${s.id}`} title={`${formatLabel(s)} · ${s.title}`} className="w-[56px]">
                      <TileCover m={s} />
                      <p className="mt-0.5 truncate text-[0.6rem] text-muted">{formatLabel(s)}</p>
                      {s.rating != null && <Stars value={s.rating} size={8} />}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Tile({
  m,
  titles,
  kids,
  parentOf,
  series,
  editable,
}: {
  m: Item;
  titles: boolean;
  kids: Item[];
  parentOf: Record<number, number>;
  series?: SeriesInfo;
  editable: boolean;
}) {
  const unit = KIND_UNIT[m.kind];
  const [side, setSide] = useState<"right" | "left">("right");
  const [open, setOpen] = useState(false);
  const title = series?.title ?? m.title;
  const rating = series ? series.rating : m.rating;
  const hasDetails = Boolean(m.review.trim() || (editable && m.notes.trim()));
  return (
    <div
      className="group/tile relative min-w-0"
      onMouseEnter={(e) => {
        // La fenêtre des adaptations s'ouvre du côté où elle a la place.
        const r = e.currentTarget.getBoundingClientRect();
        const width = Math.max(kids.length ? Math.min(3, kids.length) * 240 + 40 : 0, hasDetails ? 320 : 0);
        setSide(r.right + width > window.innerWidth ? "left" : "right");
      }}
    >
      <div className="relative">
        <Link href={`/media/${m.id}`} title={title} className="block">
          <TileCover m={m} label={title} />
        </Link>
        {kids.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="absolute bottom-1.5 left-1.5 flex h-5 min-w-5 items-center justify-center rounded-[3px] bg-black/35 px-1 text-[0.7rem] font-semibold text-white/90 ring-1 ring-white/15 backdrop-blur-[2px] transition-colors hover:bg-black/60"
              aria-label={`${kids.length} adaptation${kids.length > 1 ? "s" : ""}`}
            >
              {kids.length}
            </button>
          </>
        )}
        {/* Au survol (souris uniquement : Tailwind ne déclenche hover que sur les appareils qui en ont un) : critique et
            notes, puis les adaptations. */}
        {(kids.length > 0 || hasDetails) && (
          <div className={`absolute top-0 z-30 hidden w-max max-w-[560px] space-y-2 group-hover/tile:block ${side === "right" ? "left-full pl-2" : "right-full pr-2"}`}>
            {hasDetails && <Details m={m} title={title} editable={editable} />}
            {kids.length > 0 && <Adaptations root={m.id} kids={kids} parentOf={parentOf} />}
          </div>
        )}
        {series && (
          <span className="absolute top-1.5 right-1.5 rounded-[3px] bg-black/55 px-1 text-[0.65rem] font-semibold text-white/90 backdrop-blur-[2px]">
            {series.done}/{series.total}
          </span>
        )}
      </div>
      {titles && (
        <Link href={`/media/${m.id}`} className="mt-1 line-clamp-2 block text-xs leading-snug">
          {title}
        </Link>
      )}
      <div className="mt-1 flex h-4 items-center justify-between gap-1">
        {series ? (
          rating != null ? <Stars value={rating} size={13} /> : <span className="text-[0.68rem] text-muted">{series.total} volumes</span>
        ) : m.status === "termine" || m.rating != null ? (
          editable ? <RateButton value={m.rating} action={setRating.bind(null, m.id)} size={13} /> : <Stars value={m.rating} size={13} />
        ) : unit && (m.progress > 0 || m.total) ? (
          <span className="truncate text-[0.68rem] text-muted tabular-nums">
            {m.progress}
            {m.total ? `/${m.total}` : ""}
          </span>
        ) : (
          <span />
        )}
        <Marks m={m} />
      </div>
      {/* Sur téléphone (pas de survol), toucher le nombre ouvre les adaptations en bas de l'écran. */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={() => setOpen(false)}>
          <div className="max-h-[80dvh] w-full overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 truncate text-sm font-semibold text-white">{title}</p>
            <Adaptations root={m.id} kids={kids} parentOf={parentOf} />
          </div>
        </div>
      )}
    </div>
  );
}

// Grille dense façon Backloggd, avec onglets de statut, tri à deux critères, et un mode sélection pour changer
// le statut de plusieurs fiches d'un coup.
export function LibraryGrid({
  items,
  statut,
  sort,
  then,
  hrefFor,
  ova,
  hiddenOva,
  adaptations,
  parentOf,
  series,
  editable,
}: {
  items: Item[];
  statut: Status | null;
  sort: Sort;
  then: ThenSort;
  hrefFor: Record<string, string>;
  ova: boolean;
  hiddenOva: number;
  adaptations: Record<number, Item[]>;
  parentOf: Record<number, number>;
  series: Record<number, SeriesInfo>;
  editable: boolean;
}) {
  const router = useRouter();
  const [titles, setTitles] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<Status>("prevu");
  const [finish, setFinish] = useState<"unknown" | "today">("unknown");
  const [fb, setFb] = useState<Feedback | null>(null);
  const [pending, start] = useTransition();

  // Préférence d'affichage des titres, gardée dans ce navigateur.
  useEffect(() => {
    try {
      setTitles(localStorage.getItem("almanach-titres") === "1");
    } catch {}
  }, []);
  const toggleTitles = () => {
    setTitles((t) => {
      try {
        localStorage.setItem("almanach-titres", t ? "0" : "1");
      } catch {}
      return !t;
    });
  };

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const run = (action: () => Promise<Feedback>) =>
    start(async () => {
      const r = await action();
      setFb(r);
      if (r.ok) setSelected(new Set());
    });

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* Sur téléphone, les onglets défilent sur une ligne au lieu de s'empiler. */}
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {TABS.map((s) => (
            <Link
              key={s ?? "tous"}
              href={hrefFor[s ?? "tous"]}
              className={`shrink-0 rounded-md border px-2.5 py-1 text-sm whitespace-nowrap ${
                statut === s ? "border-fg/15 bg-fg/10 font-medium text-fg" : "border-line text-muted hover:text-fg"
              }`}
            >
              {s ? STATUS_LABEL[s] : "Tous"}
            </Link>
          ))}
        </div>
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:ml-auto sm:w-auto">
          <label className="flex items-center gap-2 text-muted">
            Trier par
            <select value={sort} onChange={(e) => router.push(hrefFor[`tri:${e.target.value}`])} className="w-auto py-1 font-medium text-star">
              {(Object.keys(SORTS) as Sort[]).map((k) => (
                <option key={k} value={k}>{SORTS[k]}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-muted">
            puis
            <select value={then} onChange={(e) => router.push(hrefFor[`puis:${e.target.value}`])} className="w-auto py-1">
              {(Object.keys(THEN_SORTS) as ThenSort[]).map((k) => (
                <option key={k} value={k}>{THEN_SORTS[k]}</option>
              ))}
            </select>
          </label>
          <Link href={hrefFor.ova} className={ova ? "text-fg" : "text-muted hover:text-fg"} aria-pressed={ova}>
            OVA
          </Link>
          <button type="button" onClick={toggleTitles} className={titles ? "text-fg" : "text-muted hover:text-fg"} aria-pressed={titles}>
            Titres
          </button>
          {editable &&
            (selecting ? (
              <>
                <button type="button" className="link" onClick={() => setSelected(new Set(items.map((m) => m.id)))}>Tout</button>
                <button type="button" className="link" onClick={() => { setSelecting(false); setSelected(new Set()); }}>Annuler</button>
              </>
            ) : (
              <button type="button" className="text-muted hover:text-fg" onClick={() => setSelecting(true)}>Sélectionner</button>
            ))}
        </div>
      </div>

      <p className="text-xs text-muted">
        {items.length} fiche{items.length > 1 ? "s" : ""}
        {hiddenOva > 0 && (
          <>
            {" · "}
            <Link href={hrefFor.ova} className="link">
              {hiddenOva} OVA masqué{hiddenOva > 1 ? "s" : ""}
            </Link>
          </>
        )}
        {fb?.text && !selecting && <span className={`ml-3 ${fb.ok ? "" : "text-danger"}`}>{fb.text}</span>}
      </p>

      <div className="grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-[repeat(auto-fill,minmax(104px,1fr))] sm:gap-x-2.5 sm:gap-y-4">
        {items.map((m) => (
          <div key={m.id} className="relative">
            <Tile m={m} titles={titles} kids={adaptations[m.id] ?? []} parentOf={parentOf} series={series[m.id]} editable={editable} />
            {selecting && (
              <button
                type="button"
                onClick={() => toggle(m.id)}
                aria-pressed={selected.has(m.id)}
                aria-label={`Sélectionner ${m.title}`}
                className={`absolute inset-0 rounded-[4px] ${selected.has(m.id) ? "bg-accent/25 ring-2 ring-accent" : "bg-transparent"}`}
              >
                <span
                  className={`absolute top-1 left-1 flex size-5 items-center justify-center rounded-full border-2 text-[0.65rem] font-bold ${
                    selected.has(m.id) ? "border-accent bg-accent text-on-accent" : "border-white bg-black/40 text-transparent"
                  }`}
                >
                  ✓
                </span>
              </button>
            )}
          </div>
        ))}
      </div>

      {selecting && (
        <div className="fixed inset-x-0 bottom-14 z-40 border-t border-line bg-bg/95 backdrop-blur sm:bottom-0">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 text-sm sm:px-6">
            <span className="font-semibold">{selected.size} sélectionné{selected.size > 1 ? "s" : ""}</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Nouveau statut">
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
            {status === "termine" && (
              <select value={finish} onChange={(e) => setFinish(e.target.value as "unknown" | "today")} aria-label="Date de fin">
                <option value="unknown">date inconnue</option>
                <option value="today">aujourd’hui</option>
              </select>
            )}
            <button type="button" className="btn" disabled={pending || !selected.size} onClick={() => run(() => bulkStatus([...selected], status, finish))}>
              {pending ? "…" : "Appliquer"}
            </button>
            <button
              type="button"
              className="btn-quiet"
              disabled={pending || !selected.size}
              onClick={() => {
                if (window.confirm(`Supprimer ${selected.size} fiche(s) et leur historique ?`)) run(() => bulkDelete([...selected]));
              }}
            >
              Supprimer
            </button>
            {fb?.text && <span className={fb.ok ? "text-muted" : "text-danger"}>{fb.text}</span>}
          </div>
        </div>
      )}
    </>
  );
}
