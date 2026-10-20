"use client";

import { useState } from "react";
import { precisionOf, today, type Precision } from "@/lib/kinds";

const LABEL: Record<Precision, string> = { jour: "Jour", mois: "Mois", annee: "Année", inconnue: "Inconnue" };

// Date de fin à précision variable : jour exact, mois, année seule, ou inconnue.
// Envoie « precision » et « when » (AAAA-MM-JJ, AAAA-MM ou AAAA), lus par parseWhen côté serveur.
export function DateFields({
  value,
  unknown = false,
  defaultPrecision = "jour",
}: {
  value: string | null;
  unknown?: boolean;
  defaultPrecision?: Precision;
}) {
  const initial: Precision = value ? precisionOf(value) : unknown ? "inconnue" : defaultPrecision;
  const [precision, setPrecision] = useState<Precision>(initial);
  const base = value ?? (unknown ? "" : today());
  const [day, setDay] = useState(base.length === 10 ? base : "");
  const [month, setMonth] = useState(base.slice(0, 7).length === 7 ? base.slice(0, 7) : "");
  const [year, setYear] = useState(base.slice(0, 4));
  const when = precision === "jour" ? day : precision === "mois" ? month : precision === "annee" ? year : "";

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select name="precision" value={precision} onChange={(e) => setPrecision(e.target.value as Precision)} aria-label="Précision de la date">
        {(Object.keys(LABEL) as Precision[]).map((p) => (
          <option key={p} value={p}>{LABEL[p]}</option>
        ))}
      </select>
      {precision === "jour" && (
        <input
          type="date"
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            if (e.target.value) {
              setMonth(e.target.value.slice(0, 7));
              setYear(e.target.value.slice(0, 4));
            }
          }}
          aria-label="Jour"
        />
      )}
      {precision === "mois" && (
        <input
          type="month"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            if (e.target.value) setYear(e.target.value.slice(0, 4));
          }}
          aria-label="Mois"
        />
      )}
      {precision === "annee" && (
        <input
          type="number"
          min={1950}
          max={2100}
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="w-24"
          aria-label="Année"
        />
      )}
      <input type="hidden" name="when" value={when} />
    </span>
  );
}
