"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toggleLike } from "@/app/actions";
import type { SearchResult } from "@/lib/catalog";
import { STATUS_LABEL, type Status } from "@/lib/kinds";
import { EntryEditor, type Entry } from "@/components/entry-editor";

const HEART = "M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2 0 3.6 1.1 5.3 3.1 1.7-2 3.3-3.1 5.3-3.1 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z";

// Bouton sous la couverture, comme celui d'AniList :
//   own  : sa propre fiche → statut ▾ (ouvre le menu de suivi) et cœur ;
//   add  : fiche d'un autre compte, absente de sa bibliothèque → « Ajouter » (menu d'ajout prérempli) ;
//   mine : fiche d'un autre compte, déjà dans sa bibliothèque → son statut, vers sa fiche.
export function StatusButton({
  own,
  add,
  mine,
  banner,
}: {
  own?: Entry;
  add?: SearchResult;
  mine?: { id: number; status: Status };
  banner: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [liked, setLiked] = useState(Boolean(own?.liked));
  const [pending, start] = useTransition();

  if (mine) {
    return (
      <Link href={`/media/${mine.id}`} className="btn w-full justify-center text-sm" title="Ta fiche">
        {STATUS_LABEL[mine.status]} · ta fiche
      </Link>
    );
  }

  return (
    <>
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(true)} className="btn min-w-0 flex-1 justify-between gap-2 text-sm">
          <span className="truncate">{own ? STATUS_LABEL[own.status] : "Ajouter"}</span>
          <span aria-hidden className="opacity-70">{own ? "▾" : "+"}</span>
        </button>
        {own && (
          <button
            type="button"
            title={liked ? "Je n’aime plus" : "J’aime"}
            aria-pressed={liked}
            disabled={pending}
            onClick={() => {
              setLiked(!liked);
              start(async () => {
                await toggleLike(own.id);
                router.refresh();
              });
            }}
            className={`flex w-10 shrink-0 items-center justify-center rounded-md ${liked ? "bg-like" : "bg-fg/10 hover:bg-fg/15"}`}
          >
            <svg viewBox="0 0 24 24" className={`size-5 ${liked ? "fill-white" : "fill-muted"}`}>
              <path d={HEART} />
            </svg>
          </button>
        )}
      </div>
      {open && (
        <EntryEditor
          result={add ?? null}
          entry={own}
          banner={banner}
          kind={own?.kind ?? add?.kind ?? "anime"}
          onClose={() => setOpen(false)}
          onAdded={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
