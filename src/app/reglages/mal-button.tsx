"use client";

import { useState } from "react";
import { runMalCovers } from "@/app/actions";

// Les couvertures MAL se récupèrent par lots (MAL limite le débit) : ce bouton enchaîne les lots jusqu'au bout.
export function MalButton() {
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn-quiet"
        disabled={running}
        onClick={async () => {
          setRunning(true);
          try {
            for (let i = 0; i < 60; i++) {
              const r = await runMalCovers();
              setText(r.text);
              if (!r.ok || !/encore/.test(r.text)) break;
            }
          } finally {
            setRunning(false);
          }
        }}
      >
        {running ? "En cours…" : "Récupérer les couvertures MAL"}
      </button>
      {text && <span className="text-sm text-muted">{text}</span>}
    </span>
  );
}
