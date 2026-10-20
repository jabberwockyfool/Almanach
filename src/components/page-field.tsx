"use client";

import { useState, useTransition } from "react";
import { setProgress, type Feedback } from "@/app/actions";

// Roman : on note la page atteinte plutôt qu'un +1. Atteindre le total termine le livre.
export function PageField({ m, compact = false }: { m: { id: number; progress: number; total: number | null }; compact?: boolean }) {
  const [fb, setFb] = useState<Feedback | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={`flex flex-wrap items-center gap-2 ${compact ? "mt-2 text-xs" : "text-sm"}`}
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => setFb(await setProgress(m.id, form)));
      }}
    >
      <label className="inline-flex items-center gap-1.5">
        <span className="text-muted">Page</span>
        <input
          key={m.progress}
          name="progress"
          type="number"
          min={0}
          max={m.total ?? undefined}
          defaultValue={m.progress || ""}
          className={compact ? "w-16 px-1.5 py-0.5" : "w-20"}
        />
        {m.total ? <span className="text-muted">/ {m.total}</span> : null}
      </label>
      <button className={compact ? "btn-quiet text-xs" : "btn"} disabled={pending}>{pending ? "…" : "OK"}</button>
      {fb && !fb.ok && <span className="text-danger">{fb.text}</span>}
    </form>
  );
}
