"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FeedItem } from "@/lib/activity";
import { Stars } from "@/components/stars";
import { hideEvent } from "@/app/actions";

type Scope = "tous" | "moi";

function ago(at: number): string {
  const s = Math.max(0, Date.now() / 1000 - at);
  if (s < 60) return "à l’instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 2 * 86400) return "hier";
  if (s < 7 * 86400) return `il y a ${Math.floor(s / 86400)} j`;
  const d = new Date(at * 1000);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

function Item({ it, onHide }: { it: FeedItem; onHide: () => void }) {
  const cover = (
    <span className="relative block aspect-[2/3] overflow-hidden rounded-[3px] bg-bg">
      {it.cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={it.cover} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
      )}
    </span>
  );
  return (
    <li className="group relative flex gap-3 rounded-md bg-raised p-2.5">
      {it.href ? <Link href={it.href} className="w-14 shrink-0">{cover}</Link> : <span className="w-14 shrink-0">{cover}</span>}
      <div className="min-w-0 flex-1 py-0.5 text-sm leading-snug">
        <p className="flex items-center gap-1.5">
          <Link href={`/u/${it.user.id}`} className="flex min-w-0 items-center gap-1.5">
            {it.user.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.user.avatar} alt="" className="size-5 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[0.65rem] font-bold text-on-accent">
                {it.user.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="truncate font-semibold text-accent hover:underline">{it.user.name}</span>
          </Link>
          <span className="ml-auto shrink-0 text-xs text-faint">{ago(it.at)}</span>
          {it.mine && (
            <button
              type="button"
              title="Retirer du fil"
              aria-label="Retirer du fil"
              onClick={async () => {
                if (!window.confirm("Retirer cette activité du fil ?")) return;
                if ((await hideEvent(it.id)).ok) onHide();
              }}
              className="-my-1 shrink-0 rounded px-1 text-base leading-none text-faint opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100 max-sm:opacity-60"
            >
              ×
            </button>
          )}
        </p>
        <p className="mt-0.5 text-muted">
          {it.text}{" "}
          {it.href ? (
            <Link href={it.href} className="text-fg hover:underline">{it.title}</Link>
          ) : (
            <span className="text-fg">{it.title}</span>
          )}
        </p>
        {it.rating != null && (
          <p className="mt-1">
            <Stars value={it.rating} size={14} />
          </p>
        )}
        {it.icons.length > 0 ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-1">
            {it.icons.slice(0, 10).map((a, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={a.icon} alt={a.name} title={a.name} loading="lazy" className="size-6 rounded-[3px] object-cover" />
            ))}
            {it.icons.length > 10 && <span className="text-xs text-faint">+{it.icons.length - 10}</span>}
          </p>
        ) : (
          it.detail && <p className="mt-1 truncate text-xs text-faint" title={it.detail}>{it.detail}</p>
        )}
      </div>
    </li>
  );
}

// Fil d'activité d'Almanach : colonne de gauche de l'accueil sur grand écran, en bas sinon.
// « Tout le monde » : les comptes du groupe ; « Moi » : le compte connecté.
export function ActivityFeed() {
  const [scope, setScope] = useState<Scope>("tous");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(true);

  const load = useCallback(async (s: Scope, before: string | null) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/activite?portee=${s}${before ? `&avant=${before}` : ""}`);
      const data = (await res.json()) as { items: FeedItem[] };
      setMore(data.items.length >= 30);
      setItems((cur) => {
        const merged = before ? [...cur, ...data.items] : data.items;
        return [...new Map(merged.map((i) => [i.id, i])).values()];
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Premier chargement, changement d'onglet, puis rafraîchissement toutes les 2 minutes.
  useEffect(() => {
    load(scope, null);
    const timer = setInterval(() => load(scope, null), 120_000);
    return () => clearInterval(timer);
  }, [scope, load]);

  return (
    <aside className="mx-auto mt-14 w-full max-w-6xl min-[1700px]:sticky min-[1700px]:top-6 min-[1700px]:order-1 min-[1700px]:mt-0 min-[1700px]:flex min-[1700px]:h-[calc(100dvh-7rem)] min-[1700px]:flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">Activité</h2>
        <div className="flex gap-1 text-xs">
          {(["tous", "moi"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`rounded px-2 py-1 ${scope === s ? "bg-fg/10 font-medium text-fg" : "text-muted hover:text-fg"}`}
            >
              {s === "tous" ? "Tout le monde" : "Moi"}
            </button>
          ))}
        </div>
      </div>
      <div className="min-[1700px]:-mr-2 min-[1700px]:flex-1 min-[1700px]:overflow-y-auto min-[1700px]:pr-2 min-[1700px]:pb-6">
        {!loading && !items.length && <p className="text-sm text-muted">Rien pour l’instant : avance un épisode, finis un jeu…</p>}
        <ul className="space-y-2 md:max-[1699px]:grid md:max-[1699px]:grid-cols-2 md:max-[1699px]:gap-2 md:max-[1699px]:space-y-0">
          {items.map((it) => (
            <Item key={it.id} it={it} onHide={() => setItems((cur) => cur.filter((x) => x.id !== it.id))} />
          ))}
        </ul>
        {items.length > 0 && more && (
          <button
            type="button"
            disabled={loading}
            className="mt-3 w-full rounded-md py-2 text-sm text-muted hover:bg-raised hover:text-fg"
            onClick={() => {
              const last = items[items.length - 1];
              load(scope, `${last.at}.${last.id}`);
            }}
          >
            {loading ? "…" : "Plus"}
          </button>
        )}
      </div>
    </aside>
  );
}
