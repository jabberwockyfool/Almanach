import "server-only";

// Letterboxd n'ouvre son API qu'aux applications agréées. On lit donc :
// - le flux RSS public du profil (les ~50 derniers visionnages, avec affiche et id TMDB) ;
// - l'export CSV (Réglages → Data → Export, fichier diary.csv) pour tout l'historique.
// L'écriture reste impossible : un film se logue sur Letterboxd, puis se synchronise ici.

const UA = "Mozilla/5.0 (compatible; Almanach/0.1)";

export type FilmWatch = {
  title: string;
  year: number | null;
  slug: string | null;
  watchedOn: string;
  rating: number | null; // sur 10
  rewatch: boolean;
  tmdbId: number | null;
  poster: string;
  liked?: boolean;
  review?: string;
};

function tag(item: string, name: string): string | null {
  const m = item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : null;
}

function decode(s: string): string {
  return s
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

export async function fetchRss(username: string): Promise<FilmWatch[]> {
  const res = await fetch(`https://letterboxd.com/${encodeURIComponent(username)}/rss/`, {
    headers: { "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Letterboxd : flux introuvable pour « ${username} » (HTTP ${res.status})`);
  const xml = await res.text();
  const out: FilmWatch[] = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const watchedOn = tag(item, "letterboxd:watchedDate");
    const title = tag(item, "letterboxd:filmTitle");
    if (!watchedOn || !title) continue; // listes et autres publications
    const link = tag(item, "link") ?? "";
    const rating = tag(item, "letterboxd:memberRating");
    out.push({
      title,
      year: Number(tag(item, "letterboxd:filmYear")) || null,
      slug: link.match(/\/film\/([^/]+)\//)?.[1] ?? null,
      watchedOn,
      rating: rating ? Number(rating) * 2 : null,
      rewatch: tag(item, "letterboxd:rewatch") === "Yes",
      liked: tag(item, "letterboxd:memberLike") === "Yes",
      // Critique : les paragraphes de la description autres que l'affiche et « Watched on … ».
      review: [...(tag(item, "description") ?? "").matchAll(/<p>([\s\S]*?)<\/p>/g)]
        .map((p) => p[1].replace(/<[^>]+>/g, "").trim())
        .filter((p) => p && !/^Watched on /.test(p))
        .join("\n\n"),
      tmdbId: Number(tag(item, "tmdb:movieId")) || null,
      poster: item.match(/<img src="([^"]+)"/)?.[1] ?? "",
    });
  }
  return out;
}

// CSV minimal (guillemets, virgules et retours à la ligne dans les champs).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

// diary.csv : Date, Name, Year, Letterboxd URI, Rating, Rewatch, Tags, Watched Date.
export function parseDiaryCsv(text: string): FilmWatch[] {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return [];
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const iName = col("name"), iYear = col("year"), iRating = col("rating"), iRewatch = col("rewatch");
  const iWatched = col("watched date") >= 0 ? col("watched date") : col("date");
  if (iName < 0 || iWatched < 0) throw new Error("Ce CSV n'a pas les colonnes de diary.csv (Name, Watched Date).");
  return rows
    .filter((r) => r[iName] && /^\d{4}-\d{2}-\d{2}$/.test(r[iWatched] ?? ""))
    .map((r) => ({
      title: r[iName],
      year: Number(r[iYear]) || null,
      slug: null,
      watchedOn: r[iWatched],
      rating: r[iRating] ? Number(r[iRating]) * 2 : null,
      rewatch: (r[iRewatch] ?? "").toLowerCase() === "yes",
      tmdbId: null,
      poster: "",
    }));
}

function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Retrouve la fiche d'un film importé du CSV (sans slug) pour récupérer affiche, slug et id TMDB.
// Letterboxd nomme ses pages d'après le titre, suffixé de l'année en cas d'homonymie : on vérifie l'année.
export async function lookupFilm(title: string, year: number | null) {
  const base = slugify(title);
  const candidates = year ? [base, `${base}-${year}`] : [base];
  for (const slug of candidates) {
    const res = await fetch(`https://letterboxd.com/film/${slug}/`, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) continue;
    const html = await res.text();
    const ogTitle = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? "";
    const pageYear = Number(ogTitle.match(/\((\d{4})\)\s*$/)?.[1]) || null;
    if (year && pageYear && pageYear !== year) continue;
    return {
      slug,
      poster: html.match(/"image":"([^"]+)"/)?.[1]?.replace(/\\\//g, "/") ?? "",
      tmdbId: Number(html.match(/data-tmdb-id="(\d+)"/)?.[1]) || null,
    };
  }
  return null;
}
