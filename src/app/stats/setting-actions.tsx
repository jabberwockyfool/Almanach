"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { editSettingValue, moveSettingValue, type Feedback } from "@/app/actions";

// Renommer ou supprimer un pays, un lieu ou une époque dans toutes ses fiches (cartes des stats).
export function SettingActions({ facet, name }: { facet: "pays" | "lieux" | "epoques"; name: string }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const run = (action: () => Promise<Feedback>) =>
    start(async () => {
      const r = await action();
      setErr(r.ok ? "" : r.text);
      if (r.ok) router.refresh();
    });
  const apply = (to: string | null) => run(() => editSettingValue(facet, name, to));

  return (
    // Icônes discrètes, visibles au survol de la carte (toujours sur écran tactile) : le nom garde la place.
    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
      <button
        type="button"
        disabled={pending}
        title="Renommer"
        aria-label={`Renommer ${name}`}
        className="flex size-6 items-center justify-center rounded text-sm text-muted hover:bg-fg/10 hover:text-fg"
        onClick={() => {
          const to = window.prompt(`Renommer « ${name} » dans toutes tes fiches :`, name)?.trim();
          if (to && to !== name) apply(to);
        }}
      >
        ✎
      </button>
      {facet !== "epoques" && (
        <button
          type="button"
          disabled={pending}
          title={facet === "pays" ? "En faire un lieu" : "En faire un pays"}
          aria-label={facet === "pays" ? `Passer ${name} en lieu` : `Passer ${name} en pays`}
          className="flex size-6 items-center justify-center rounded text-sm text-muted hover:bg-fg/10 hover:text-fg"
          onClick={() => {
            if (window.confirm(`Passer « ${name} » ${facet === "pays" ? "des pays aux lieux" : "des lieux aux pays"} dans toutes tes fiches ?`)) run(() => moveSettingValue(facet, name));
          }}
        >
          ⇄
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        title="Supprimer"
        aria-label={`Supprimer ${name}`}
        className="flex size-6 items-center justify-center rounded text-base text-muted hover:bg-fg/10 hover:text-danger"
        onClick={() => {
          if (window.confirm(`Retirer « ${name} » de toutes tes fiches ?`)) apply(null);
        }}
      >
        ×
      </button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </span>
  );
}
