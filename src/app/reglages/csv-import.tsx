"use client";

import { useActionState } from "react";
import { importLetterboxdCsv } from "@/app/actions";

export function CsvImport() {
  const [state, action, pending] = useActionState(importLetterboxdCsv, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="file" name="file" accept=".csv,text/csv" className="max-w-full" />
      <button className="btn-quiet" disabled={pending}>{pending ? "…" : "Importer diary.csv"}</button>
      {state?.text && <span className={`text-sm ${state.ok ? "text-muted" : "text-danger"}`}>{state.text}</span>}
    </form>
  );
}
