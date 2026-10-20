"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { search } from "@/app/actions";
import type { SearchResult } from "@/lib/catalog";
import { KINDS, KIND_LABEL, type Kind } from "@/lib/kinds";
import { Cover } from "@/components/cover";
import { EntryEditor } from "@/components/entry-editor";

const SOURCE: Record<Kind, string> = {
  anime: "AniList",
  manga: "AniList",
  ln: "AniList",
  serie: "TVmaze",
  film: "TMDB",
  jeu: "Steam",
  roman: "Open Library (titre, auteur ou ISBN)",
};

type Result = SearchResult & { owned?: number };

export function AddSearch({ hasTmdb }: { hasTmdb: boolean }) {
  const [kind, setKind] = useState<Kind>("anime");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  // Menu d'ajout ouvert : un résultat, ou « manual » pour un ajout à la main.
  const [editing, setEditing] = useState<Result | "manual" | null>(null);
  const [added, setAdded] = useState<{ id: number; title: string } | null>(null);

  const run = (k: Kind, query: string) => {
    if (!query.trim()) return;
    start(async () => {
      const r = await search(k, query);
      setResults(r.results);
      setError(r.error ?? "");
    });
  };

  return (
    <section>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setResults(null);
              run(k, q);
            }}
            className={kind === k ? "font-semibold text-fg" : "text-muted hover:text-fg"}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(kind, q);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Chercher sur ${SOURCE[kind]}`} className="flex-1" autoFocus />
        <button className="btn" disabled={pending}>{pending ? "…" : "Chercher"}</button>
      </form>
      <p className="mt-3 text-sm text-muted">
        Introuvable ?{" "}
        <button type="button" className="link text-fg" onClick={() => setEditing("manual")}>
          L’ajouter à la main
        </button>
      </p>
      {kind === "film" && !hasTmdb && (
        <p className="mt-3 text-sm text-muted">
          La recherche de films demande une clé TMDB (TMDB_TOKEN). Les films arrivent sinon par Letterboxd, ou s’ajoutent à la main.
        </p>
      )}
      {added && (
        <p className="mt-3 text-sm">
          <span className="text-muted">Ajouté :</span>{" "}
          <Link href={`/media/${added.id}`} className="link">{added.title}</Link>
        </p>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {results && !results.length && !error && <p className="mt-4 text-sm text-muted">Aucun résultat.</p>}
      {results && results.length > 0 && (
        <div className="mt-6 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-5 lg:grid-cols-6">
          {results.map((r, i) => {
            const body = (
              <>
                <Cover src={r.cover ?? ""} title={r.title} className={r.owned ? "opacity-60" : ""} />
                <p className="mt-2 line-clamp-2 text-sm leading-snug font-medium">{r.title}</p>
                <p className="text-xs text-muted">
                  {r.owned ? "Dans ta bibliothèque" : [r.year, r.subtitle].filter(Boolean).join(" · ")}
                </p>
              </>
            );
            return r.owned ? (
              <Link key={i} href={`/media/${r.owned}`} className="min-w-0">{body}</Link>
            ) : (
              <button key={i} type="button" className="min-w-0 text-left" onClick={() => setEditing(r)}>
                {body}
              </button>
            );
          })}
        </div>
      )}
      {editing && (
        <EntryEditor
          result={editing === "manual" ? null : editing}
          kind={kind}
          onClose={() => setEditing(null)}
          onAdded={(id, title) => {
            if (editing !== "manual") setResults((rs) => rs?.map((r) => (r === editing ? { ...r, owned: id } : r)) ?? null);
            setAdded({ id, title });
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
