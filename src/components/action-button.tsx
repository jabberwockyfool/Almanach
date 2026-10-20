"use client";

import { useState, useTransition } from "react";
import type { Feedback } from "@/app/actions";

// Bouton qui lance une server action et affiche son résultat à côté.
export function ActionButton({
  action,
  children,
  quiet = false,
  confirm,
  className = "",
}: {
  action: () => Promise<Feedback | void>;
  children: React.ReactNode;
  quiet?: boolean;
  confirm?: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [fb, setFb] = useState<Feedback | null>(null);
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <button
        type="button"
        disabled={pending}
        className={quiet ? "btn-quiet" : "btn"}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => setFb((await action()) ?? null));
        }}
      >
        {pending ? "…" : children}
      </button>
      {fb?.text && <span className={`text-sm ${fb.ok ? "text-muted" : "text-danger"}`}>{fb.text}</span>}
    </span>
  );
}

// Formulaire branché sur une server action (id lié), avec le retour affiché sous le bouton.
export function ActionForm({
  action,
  children,
  submit,
  className = "",
  resetOnSuccess = false,
}: {
  action: (form: FormData) => Promise<Feedback>;
  children: React.ReactNode;
  submit: string;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [pending, start] = useTransition();
  const [fb, setFb] = useState<Feedback | null>(null);
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const formEl = e.currentTarget;
        const data = new FormData(formEl);
        start(async () => {
          const r = await action(data);
          setFb(r);
          if (r.ok && resetOnSuccess) formEl.reset();
        });
      }}
    >
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn" disabled={pending}>
          {pending ? "…" : submit}
        </button>
        {fb?.text && <span className={`text-sm ${fb.ok ? "text-muted" : "text-danger"}`}>{fb.text}</span>}
      </div>
    </form>
  );
}
