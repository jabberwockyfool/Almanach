"use client";

import { useState, useTransition } from "react";
import { setBanner, type Feedback } from "@/app/actions";

// Réduit une image envoyée à 1600 px de large (JPEG) avant de la garder dans la base.
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

// Bannière de la fiche choisie à la main (adresse ou image envoyée) ; sinon celle des sources.
export function BannerEditor({ mediaId, banner, custom }: { mediaId: number; banner: string | null; custom: boolean }) {
  const [url, setUrl] = useState("");
  const [fb, setFb] = useState<Feedback | null>(null);
  const [pending, start] = useTransition();
  const apply = (value: string) => start(async () => setFb(await setBanner(mediaId, value)));

  return (
    <div className="space-y-3 text-sm">
      <h3 className="font-medium">Bannière</h3>
      {banner ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={banner} alt="" referrerPolicy="no-referrer" className="aspect-[4/1] w-full rounded-md object-cover" />
      ) : (
        <p className="text-muted">Aucune bannière : la page affiche la couverture floutée.</p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) apply(url.trim());
        }}
      >
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Adresse d’une image (large)" className="min-w-0 flex-1" />
        <button className="btn-quiet" disabled={pending}>OK</button>
      </form>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-quiet cursor-pointer text-xs">
          <p>Envoyer une image</p>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) apply(await shrink(file));
            }}
          />
        </label>
        {custom && (
          <button type="button" className="btn-quiet text-xs" disabled={pending} onClick={() => apply("")}>
            Revenir à la bannière des sources
          </button>
        )}
        {fb?.text && <span className={fb.ok ? "text-muted" : "text-danger"}>{fb.text}</span>}
      </div>
    </div>
  );
}
