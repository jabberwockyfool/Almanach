"use client";

import { useState, useTransition } from "react";
import { setCoverSource } from "@/app/actions";

// Couvertures des anime dans les grilles : MyAnimeList ou AniList.
export function CoverChoice({ value }: { value: "mal" | "anilist" }) {
  const [current, setCurrent] = useState(value);
  const [pending, start] = useTransition();
  return (
    <div className="inline-flex rounded-md border border-line p-0.5 text-sm" role="radiogroup" aria-label="Couvertures des anime">
      {(
        [
          ["mal", "MyAnimeList"],
          ["anilist", "AniList"],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={current === v}
          disabled={pending}
          onClick={() => {
            setCurrent(v);
            start(async () => void (await setCoverSource(v)));
          }}
          className={`rounded px-3 py-1.5 ${current === v ? "bg-fg/10 font-medium text-fg" : "text-muted hover:text-fg"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
