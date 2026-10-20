"use client";

import { useState } from "react";
import { DateFields } from "@/components/date-fields";
import { StarField } from "@/components/stars";

// Deux façons de noter une fin :
// - « Fini à l'instant » : daté d'aujourd'hui, et publié dans le fil d'activité ;
// - « Ajouter à la bibliothèque » : quelque chose vu ou joué avant, à une date approximative (jour, mois, année
//   ou inconnue), sans apparaître dans le fil.
export function FinishFields({ rating, isGame }: { rating: number | null; isGame: boolean }) {
  const [mode, setMode] = useState<"instant" | "bibliotheque">("instant");
  return (
    <div className="space-y-4">
      <input type="hidden" name="mode" value={mode} />
      <div className="inline-flex rounded-md border border-line p-0.5 text-sm" role="radiogroup" aria-label="Type de fin">
        {(
          [
            ["instant", "Fini à l’instant"],
            ["bibliotheque", "Ajouter à la bibliothèque"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className={`rounded px-3 py-1.5 ${mode === value ? "bg-fg/10 font-medium text-fg" : "text-muted hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "bibliotheque" ? (
        <div>
          <span className="mb-1 block text-sm text-muted">Terminé vers</span>
          <DateFields value={null} defaultPrecision="annee" />
          <p className="mt-1 text-xs text-muted">Une date approximative suffit. N’apparaît pas dans le fil d’activité.</p>
        </div>
      ) : (
        <p className="text-xs text-muted">
          Daté d’aujourd’hui et ajouté au fil d’activité.
          {isGame ? " La fin sera aussi reportée dans ton journal Backloggd à la prochaine synchro du compagnon." : ""}
        </p>
      )}
      <div>
        <span className="mb-1 block text-sm text-muted">Note</span>
        <StarField defaultValue={rating} />
      </div>
    </div>
  );
}
