"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Wrapped } from "@/lib/stats";
import { KIND_COLOR, KIND_DONE, KIND_LABEL, KIND_PLURAL, MONTHS, formatDate, type Kind } from "@/lib/kinds";
import { Stars } from "@/components/stars";

// Récap de l'année en diapositives plein écran, façon « Wrapped » : toucher à droite / à gauche (ou les
// flèches du clavier) pour avancer / reculer, et chaque diapositive s'enregistre en image 1080 × 1920.

// Les images passent par le relais de l'appli : sans lui, l'export PNG est bloqué (canvas « teinté »).
// Les couvertures envoyées depuis l'appareil (data:) sont déjà locales.
const img = (src: string) => (!src || src.startsWith("data:") ? src : `/api/img?u=${encodeURIComponent(src)}`);

function Mosaic({ covers, cols = 4 }: { covers: { title: string; cover: string }[]; cols?: number }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {covers.map((c, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={img(c.cover)} alt={c.title} className="aspect-[2/3] w-full rounded-sm object-cover" />
      ))}
    </div>
  );
}

function Dot({ kind }: { kind: Kind }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[kind] }} />;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-6 text-sm font-semibold tracking-[0.2em] text-[#e8c26a] uppercase">{children}</p>;
}

function hours(min: number) {
  const h = Math.round(min / 60);
  return `${h} h`;
}

function buildSlides(d: Wrapped): { key: string; node: React.ReactNode }[] {
  const s: { key: string; node: React.ReactNode }[] = [];
  s.push({
    key: "intro",
    node: (
      <div>
        <Eyebrow>Almanach</Eyebrow>
        <p className="text-[7rem] leading-none font-extrabold tracking-tighter">{d.year}</p>
        <p className="mt-6 text-2xl font-medium">
          {d.total} œuvre{d.total > 1 ? "s" : ""} terminée{d.total > 1 ? "s" : ""}.
        </p>
      </div>
    ),
  });
  if (!d.total) return s;

  s.push({
    key: "types",
    node: (
      <div>
        <Eyebrow>Ton année, par type</Eyebrow>
        <ul className="space-y-5">
          {d.byKind.map((k) => (
            <li key={k.kind} className="flex items-baseline gap-4">
              <span className="w-24 text-6xl font-extrabold tracking-tight tabular-nums">{k.count}</span>
              <span className="flex items-center gap-2.5 text-xl">
                <Dot kind={k.kind} />
                {(k.count > 1 ? KIND_PLURAL[k.kind] : KIND_LABEL[k.kind]).toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      </div>
    ),
  });

  const max = Math.max(...d.byMonth, 1);
  const noMonth = d.total - d.byMonth.reduce((a, b) => a + b, 0);
  s.push({
    key: "mois",
    node: (
      <div>
        <Eyebrow>Mois par mois</Eyebrow>
        <p className="mb-10 text-3xl leading-tight font-bold">
          Ton mois le plus rempli : <span className="text-[#e8c26a]">{MONTHS[d.topMonth]}</span>, {d.byMonth[d.topMonth]} fin
          {d.byMonth[d.topMonth] > 1 ? "s" : ""}.
        </p>
        <div className="flex h-56 items-end gap-[2px]" role="img" aria-label={d.byMonth.map((n, i) => `${MONTHS[i]} : ${n}`).join(", ")}>
          {d.byMonth.map((n, i) => (
            <div key={i} className="group relative flex h-full flex-1 flex-col justify-end" title={`${MONTHS[i]} : ${n}`}>
              {i === d.topMonth && <span className="mb-1 text-center text-sm font-bold">{n}</span>}
              <div
                className={`rounded-t-[4px] ${i === d.topMonth ? "bg-[#e8c26a]" : "bg-white/35"}`}
                style={{ height: `${(n / max) * 85}%`, minHeight: n ? 4 : 1 }}
              />
              <span className="mt-2 text-center text-xs text-white/60 uppercase">{MONTHS[i][0]}</span>
            </div>
          ))}
        </div>
        {noMonth > 0 && (
          <p className="mt-6 text-sm text-white/60">
            + {noMonth} fin{noMonth > 1 ? "s" : ""} sans mois précis
          </p>
        )}
      </div>
    ),
  });

  for (const k of d.byKind) {
    s.push({
      key: `k-${k.kind}`,
      node: (
        <div>
          <Eyebrow>
            <span className="inline-flex items-center gap-2"><Dot kind={k.kind} /> {KIND_PLURAL[k.kind]}</span>
          </Eyebrow>
          <p className="mb-8 text-5xl leading-tight font-extrabold tracking-tight">
            {k.count} {(k.count > 1 ? KIND_PLURAL[k.kind] : KIND_LABEL[k.kind]).toLowerCase()} {k.count > 1 ? KIND_DONE[k.kind] : KIND_DONE[k.kind].replace(/s$/, "")}
          </p>
          {k.covers.length > 0 && <Mosaic covers={k.covers} cols={k.covers.length > 8 ? 6 : k.covers.length > 3 ? 4 : 3} />}
        </div>
      ),
    });
  }

  const facts: [string, string][] = [];
  if (d.gameMinutes) facts.push([hours(d.gameMinutes), "de jeu dans ton journal Backloggd"]);
  if (d.episodes) facts.push([`≈ ${d.episodes}`, "épisodes, séries et anime terminés"]);
  if (d.chapters) facts.push([`≈ ${d.chapters}`, "chapitres de manga"]);
  if (d.volumes) facts.push([`≈ ${d.volumes}`, d.volumes > 1 ? "volumes de light novels" : "volume de light novel"]);
  if (d.pages) facts.push([`≈ ${d.pages.toLocaleString("fr-FR")}`, "pages de romans"]);
  if (d.streak > 1) facts.push([`${d.streak} jours`, "d’affilée sans décrocher"]);
  if (d.busiestDay && d.busiestDay.count > 1) facts.push([`${d.busiestDay.count} fins`, `le ${formatDate(d.busiestDay.day)}`]);
  if (d.rewatches) facts.push([String(d.rewatches), d.rewatches > 1 ? "revisionnages" : "revisionnage"]);
  if (facts.length) {
    s.push({
      key: "chiffres",
      node: (
        <div>
          <Eyebrow>En chiffres</Eyebrow>
          <ul className="space-y-6">
            {facts.map(([big, small]) => (
              <li key={small}>
                <p className="text-5xl font-extrabold tracking-tight tabular-nums">{big}</p>
                <p className="text-lg text-white/70">{small}</p>
              </li>
            ))}
          </ul>
        </div>
      ),
    });
  }

  if (d.favorites.length) {
    s.push({
      key: "favoris",
      node: (
        <div>
          <Eyebrow>Coups de cœur</Eyebrow>
          <ol className="space-y-4">
            {d.favorites.map((f, i) => (
              <li key={i} className="flex items-center gap-4">
                <span className="w-6 text-2xl font-extrabold text-white/40">{i + 1}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img(f.cover)} alt="" className="aspect-[2/3] w-14 shrink-0 rounded-sm bg-white/10 object-cover" />
                <span className="min-w-0">
                  <span className="line-clamp-2 text-lg leading-snug font-semibold">{f.title}</span>
                  <Stars value={f.rating} size={16} />
                  <span className="ml-2 text-sm text-white/60">{KIND_LABEL[f.kind]}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ),
    });
  }

  if (d.first && d.last && d.first.log_id !== d.last.log_id) {
    const pair = [
      ["Premier", d.first],
      ["Dernier", d.last],
    ] as const;
    s.push({
      key: "bornes",
      node: (
        <div>
          <Eyebrow>Du premier au dernier</Eyebrow>
          <div className="grid grid-cols-2 gap-5">
            {pair.map(([label, f]) => (
              <div key={label}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img(f.cover)} alt="" className="aspect-[2/3] w-full rounded-md bg-white/10 object-cover" />
                <p className="mt-3 text-sm text-white/60">{label} · {formatDate(f.finished_on)}</p>
                <p className="line-clamp-2 font-semibold">{f.title}</p>
              </div>
            ))}
          </div>
        </div>
      ),
    });
  }

  if (d.covers.length) {
    const covers = d.covers.slice(-48);
    s.push({
      key: "mosaique",
      node: (
        <div>
          <Mosaic covers={covers} cols={covers.length > 30 ? 8 : covers.length > 12 ? 6 : 4} />
          <p className="mt-8 text-4xl font-extrabold tracking-tight">{d.year}</p>
          <p className="text-lg text-white/70">{d.total} œuvres · Almanach</p>
        </div>
      ),
    });
  }
  return s;
}

export function Slides({ data }: { data: Wrapped }) {
  const slides = buildSlides(data);
  const [i, setI] = useState(0);
  const [saving, setSaving] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const go = useCallback((delta: number) => setI((v) => Math.min(slides.length - 1, Math.max(0, v + delta))), [slides.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  async function save() {
    if (!frame.current) return;
    setSaving(true);
    try {
      const { toPng } = await import("html-to-image");
      const node = frame.current;
      const url = await toPng(node, { pixelRatio: 1080 / node.offsetWidth, backgroundColor: "#0d0d0f", cacheBust: true });
      const a = document.createElement("a");
      a.href = url;
      a.download = `almanach-${data.year}-${slides[i].key}.png`;
      a.click();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black text-white">
      <div className="relative h-full max-h-[min(100dvh,960px)] w-full max-w-[540px] select-none">
        {/* La diapositive exportée : format 9:16. */}
        <div ref={frame} className="absolute inset-0 flex flex-col justify-center overflow-hidden bg-[#0d0d0f] px-8 py-20">
          {slides[i].node}
        </div>
        <div className="absolute inset-x-3 top-3 flex gap-1">
          {slides.map((sl, n) => (
            <span key={sl.key} className={`h-0.5 flex-1 rounded-full ${n <= i ? "bg-white" : "bg-white/25"}`} />
          ))}
        </div>
        <button type="button" aria-label="Précédent" className="absolute inset-y-0 left-0 w-1/3" onClick={() => go(-1)} />
        <button type="button" aria-label="Suivant" className="absolute inset-y-0 right-0 w-2/3" onClick={() => go(1)} />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-5 py-4 text-sm text-white/70">
          <Link href={`/annee/${data.year}`} className="relative z-10 hover:text-white">Fermer</Link>
          <span>{i + 1} / {slides.length}</span>
          <button type="button" onClick={save} disabled={saving} className="relative z-10 hover:text-white">
            {saving ? "…" : "Enregistrer l’image"}
          </button>
        </div>
      </div>
    </div>
  );
}
