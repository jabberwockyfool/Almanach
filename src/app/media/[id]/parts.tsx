"use client";

import { useState, useTransition } from "react";
import { removeTheme } from "@/app/actions";

// Description repliée au-delà de quelques lignes, comme sur AniList.
export function Clamp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 420;
  return (
    <div className="max-w-3xl text-sm leading-relaxed text-muted">
      <p className={`whitespace-pre-line ${long && !open ? "line-clamp-5" : ""}`}>{text}</p>
      {long && (
        <button type="button" className="mt-1 text-xs text-fg hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Réduire" : "Lire la suite"}
        </button>
      )}
    </div>
  );
}

// Tags avec leur pertinence ; ceux qui dévoilent l'intrigue restent cachés jusqu'au clic.
export function TagList({ tags }: { tags: { name: string; rank: number; spoiler: boolean }[] }) {
  const [spoil, setSpoil] = useState(false);
  const spoilers = tags.filter((t) => t.spoiler).length;
  const shown = tags.filter((t) => spoil || !t.spoiler);
  return (
    <div className="space-y-1.5">
      {shown.map((t) => (
        <p key={t.name} className={`flex items-baseline justify-between gap-2 rounded bg-raised px-2.5 py-1.5 text-xs ${t.spoiler ? "text-danger" : ""}`}>
          <span className="min-w-0 truncate">{t.name}</span>
          <span className="shrink-0 text-faint tabular-nums">{t.rank} %</span>
        </p>
      ))}
      {spoilers > 0 && (
        <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setSpoil(!spoil)}>
          {spoil ? "Cacher les tags spoilers" : `Afficher ${spoilers} tag${spoilers > 1 ? "s" : ""} spoiler`}
        </button>
      )}
    </div>
  );
}

export type ThemeRow = {
  key: string;
  id?: number; // thème ajouté à la main (supprimable)
  label: string;
  type: string;
  title: string;
  artists: string;
  episodes: string;
  video: string; // webm animethemes
  youtube: string; // id YouTube
  spoiler: boolean;
};

function Row({ t, editable }: { t: ThemeRow; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();
  if (gone) return null;
  return (
    <li className="overflow-hidden rounded-md bg-raised">
      <div className="flex items-start gap-2 px-3 py-2 text-sm">
        <button type="button" onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left" disabled={!t.video && !t.youtube}>
          <span className="text-faint">{t.label}</span>{" "}
          <span className="font-medium">« {t.title || "Sans titre"} »</span>
          {t.artists && <span className="text-muted"> par {t.artists}</span>}
          {t.episodes && <span className="text-faint"> (ép. {t.episodes})</span>}
          {t.spoiler && <span className="text-danger"> · spoiler</span>}
          {(t.video || t.youtube) && <span className="ml-1 text-accent">{open ? "▾" : "▸"}</span>}
        </button>
        {editable && t.id && (
          <button
            type="button"
            className="text-xs text-faint hover:text-danger"
            disabled={pending}
            onClick={() => start(async () => setGone((await removeTheme(t.id!)).ok))}
          >
            Retirer
          </button>
        )}
      </div>
      {open &&
        (t.video ? (
          <video src={t.video} controls autoPlay preload="none" className="aspect-video w-full bg-black" />
        ) : (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${t.youtube}?autoplay=1`}
            title={t.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            className="aspect-video w-full bg-black"
          />
        ))}
    </li>
  );
}

// Openings à gauche, endings (et chansons d'insert) à droite ; la vidéo se charge au clic.
export function ThemeList({ themes, editable }: { themes: ThemeRow[]; editable: boolean }) {
  const cols = [
    ["Openings", themes.filter((t) => t.type === "OP")],
    ["Endings", themes.filter((t) => t.type !== "OP")],
  ] as const;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {cols.map(([title, list]) =>
        list.length ? (
          <div key={title}>
            <h3 className="mb-2 text-sm font-medium">{title}</h3>
            <ul className="space-y-2">
              {list.map((t) => (
                <Row key={t.key} t={t} editable={editable} />
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}

// Grille de relations limitée à deux lignes (2, 4 ou 6 cartes selon la largeur), puis « Voir tout ».
export function LimitedGrid({ children }: { children: React.ReactNode[] }) {
  const [all, setAll] = useState(false);
  const n = children.length;
  const hide = (i: number) => (all ? "" : i >= 6 ? "hidden" : i >= 4 ? "hidden lg:block" : i >= 2 ? "hidden sm:block" : "");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {children.map((c, i) => (
          <div key={i} className={hide(i)}>{c}</div>
        ))}
      </div>
      {!all && n > 2 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className={`mt-3 text-sm text-muted hover:text-fg ${n > 6 ? "" : n > 4 ? "lg:hidden" : "sm:hidden"}`}
        >
          Voir tout ({n})
        </button>
      )}
    </>
  );
}
