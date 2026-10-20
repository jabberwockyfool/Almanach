"use client";

import { useState, useTransition } from "react";
import type { Feedback } from "@/app/actions";

// Note sur 10 affichée en 5 étoiles remplies au prorata, façon Backloggd : 7,5/10 → 3,75 étoiles.
// En saisie, un clic choisit la demi-étoile (ou le quart avec step="quarter") sous le curseur ;
// recliquer la note actuelle l'efface.

const PATH = "M12 1.6l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.7l-6.4 3.5 1.4-7.1-5.3-5 7.2-.9z";

// Largeur à colorer pour remplir une fraction donnée de la SURFACE de l'étoile (par pas de 5 %), calculée
// sur ce tracé. Couper à 75 % de la largeur en colorerait 94 % de la surface (la pointe droite est fine) :
// un quart d'étoile se voyait à peine, trois quarts paraissaient pleins. Affichage seulement, la note ne change pas.
const AREA_TO_WIDTH = [
  0, 0.237, 0.283, 0.313, 0.343, 0.373, 0.403, 0.43, 0.454, 0.479, 0.5,
  0.523, 0.547, 0.572, 0.599, 0.629, 0.659, 0.689, 0.719, 0.765, 1,
];

function visualWidth(fill: number): number {
  if (fill <= 0) return 0;
  if (fill >= 1) return 1;
  const i = Math.floor(fill * 20);
  const t = fill * 20 - i;
  return AREA_TO_WIDTH[i] + (AREA_TO_WIDTH[i + 1] - AREA_TO_WIDTH[i]) * t;
}

// Inverse : fraction de surface sous le curseur, pour que la saisie corresponde à ce qui s'affiche.
function areaAt(width: number): number {
  for (let i = 0; i < 20; i++) {
    const a = AREA_TO_WIDTH[i];
    const b = AREA_TO_WIDTH[i + 1];
    if (width <= b) return (i + (b > a ? (width - a) / (b - a) : 0)) / 20;
  }
  return 1;
}

function Star({ fill, size }: { fill: number; size: number }) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} className="absolute inset-0 fill-star-empty" aria-hidden>
        <path d={PATH} />
      </svg>
      {fill > 0 && (
        <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${visualWidth(fill) * 100}%` }}>
          <svg viewBox="0 0 24 24" width={size} height={size} className="fill-star" aria-hidden>
            <path d={PATH} />
          </svg>
        </span>
      )}
    </span>
  );
}

export function Stars({
  value,
  onChange,
  size = 16,
  step = "half",
  disabled = false,
}: {
  value: number | null;
  onChange?: (v: number | null) => void;
  size?: number;
  step?: "half" | "quarter";
  disabled?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const interactive = Boolean(onChange) && !disabled;
  const parts = step === "quarter" ? 4 : 2;
  const pick = (e: React.MouseEvent<HTMLSpanElement>, i: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = areaAt(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
    return (i + Math.max(1, Math.ceil(frac * parts)) / parts) * 2;
  };
  const label = value != null ? `${(value / 2).toLocaleString("fr-FR")} étoile${value > 2 ? "s" : ""} sur 5` : "Pas de note";
  return (
    <span
      className={`inline-flex items-center ${interactive ? "cursor-pointer" : ""}`}
      style={{ gap: Math.max(1, size / 8) }}
      onMouseLeave={() => setHover(null)}
      role={interactive ? "slider" : "img"}
      aria-label={label}
      title={interactive ? undefined : label}
      aria-valuemin={interactive ? 0 : undefined}
      aria-valuemax={interactive ? 10 : undefined}
      aria-valuenow={interactive ? (value ?? 0) : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={(e) => interactive && e.preventDefault()}
      onKeyDown={(e) => {
        if (!interactive) return;
        const inc = step === "quarter" ? 0.5 : 1;
        if (e.key === "ArrowRight") onChange!(Math.min(10, (value ?? 0) + inc));
        if (e.key === "ArrowLeft") onChange!((value ?? 0) - inc > 0 ? (value ?? 0) - inc : null);
      }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="inline-flex"
          onMouseMove={interactive ? (e) => setHover(pick(e, i)) : undefined}
          onClick={
            interactive
              ? (e) => {
                  e.stopPropagation();
                  const v = pick(e, i);
                  setHover(null);
                  onChange!(v === value ? null : v);
                }
              : undefined
          }
        >
          <Star fill={Math.max(0, Math.min(1, shown / 2 - i))} size={size} />
        </span>
      ))}
    </span>
  );
}

// Champ de formulaire : les étoiles plus un input caché « rating ».
export function StarField({ name = "rating", defaultValue }: { name?: string; defaultValue: number | null }) {
  const [v, setV] = useState<number | null>(defaultValue);
  return (
    <span className="inline-flex items-center gap-3">
      <Stars value={v} onChange={setV} size={28} step="quarter" />
      <span className="text-sm text-muted tabular-nums">{v != null ? `${v.toLocaleString("fr-FR")}/10` : ""}</span>
      <input type="hidden" name={name} value={v ?? ""} />
    </span>
  );
}

// Étoiles qui enregistrent aussitôt via une server action (note de la fiche ou d'une fin).
export function RateButton({
  value,
  action,
  size = 16,
  step = "half",
  showValue = false,
}: {
  value: number | null;
  action: (rating: number | null) => Promise<Feedback>;
  size?: number;
  step?: "half" | "quarter";
  showValue?: boolean;
}) {
  const [v, setV] = useState(value);
  // Suit la note venue du serveur quand la page se rafraîchit (ex. la note de la fiche reportée sur la fin).
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setV(value);
  }
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      <Stars
        value={v}
        size={size}
        step={step}
        disabled={pending}
        onChange={(next) => {
          setV(next);
          start(async () => {
            const r = await action(next);
            setErr(r.ok ? "" : r.text);
          });
        }}
      />
      {showValue && v != null && <span className="text-sm text-muted tabular-nums">{v.toLocaleString("fr-FR")}/10</span>}
      {err && <span className="text-xs text-danger">{err}</span>}
    </span>
  );
}
