"use client";

import { useId, useState } from "react";

// Champ à plusieurs valeurs (pays, lieux, époques) : une étiquette par valeur, Entrée ou virgule pour ajouter,
// × ou Retour arrière (champ vide) pour retirer. Envoie les valeurs jointes par « , » dans un input caché.
// suggestions : valeurs déjà utilisées dans la bibliothèque, pour garder la même orthographe.
export function ListField({
  name,
  defaultValue,
  placeholder,
  suggestions = [],
}: {
  name: string;
  defaultValue: string;
  placeholder: string;
  suggestions?: string[];
}) {
  const [values, setValues] = useState(() => defaultValue.split(",").map((v) => v.trim()).filter(Boolean));
  const [text, setText] = useState("");
  const list = useId();
  const add = (raw: string) => {
    const parts = raw.split(/[,;]/).map((v) => v.trim()).filter(Boolean);
    if (!parts.length) return;
    // Même orthographe qu'une valeur existante si elle ne diffère que par la casse.
    const norm = parts.map((p) => suggestions.find((s) => s.toLowerCase() === p.toLowerCase()) ?? p);
    setValues((cur) => [...cur, ...norm.filter((p) => !cur.some((c) => c.toLowerCase() === p.toLowerCase()))]);
    setText("");
  };

  return (
    <div className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-line bg-raised px-2 py-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
      <input type="hidden" name={name} value={[...values, ...(text.trim() ? [text.trim()] : [])].join(", ")} />
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded bg-fg/10 py-0.5 pr-1 pl-2 text-sm">
          {v}
          <button type="button" aria-label={`Retirer ${v}`} onClick={() => setValues(values.filter((x) => x !== v))} className="px-0.5 text-muted hover:text-fg">
            ×
          </button>
        </span>
      ))}
      <input
        value={text}
        list={list}
        onChange={(e) => {
          if (/[,;]/.test(e.target.value)) add(e.target.value);
          else setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Entrée ajoute la valeur au lieu d'envoyer le formulaire.
            if (text.trim()) {
              e.preventDefault();
              add(text);
            }
          } else if (e.key === "Backspace" && !text && values.length) {
            setValues(values.slice(0, -1));
          }
        }}
        onBlur={() => add(text)}
        placeholder={values.length ? "" : placeholder}
        aria-label={placeholder}
        // Les styles globaux des champs (bordure, fond) ne doivent pas s'appliquer à l'intérieur de la liste.
        style={{ border: 0, background: "transparent", padding: "2px", outline: "none" }}
        className="min-w-24 flex-1"
      />
      <datalist id={list}>
        {suggestions.filter((s) => !values.includes(s)).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
