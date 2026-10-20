// Types de médias, statuts et libellés. Partagé entre serveur et client (aucune dépendance serveur).

export const KINDS = ["film", "serie", "jeu", "anime", "manga", "ln", "roman"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  film: "Film",
  serie: "Série",
  jeu: "Jeu",
  anime: "Anime",
  manga: "Manga",
  ln: "Light novel",
  roman: "Roman",
};

export const KIND_PLURAL: Record<Kind, string> = {
  film: "Films",
  serie: "Séries",
  jeu: "Jeux",
  anime: "Anime",
  manga: "Manga",
  ln: "Light novels",
  roman: "Romans",
};

// Unité de progression : ce que compte le bouton « +1 ».
export const KIND_UNIT: Record<Kind, string | null> = {
  film: null,
  serie: "épisode",
  jeu: null,
  anime: "épisode",
  manga: "chapitre",
  ln: "volume",
  roman: "page",
};

// Verbe du passé pour les phrases du récap (« 12 films vus »).
export const KIND_DONE: Record<Kind, string> = {
  film: "vus",
  serie: "terminées",
  jeu: "terminés",
  anime: "terminés",
  manga: "terminés",
  ln: "terminés",
  roman: "lus",
};

// Couleur de repère par type (variables --k-* de globals.css, pas propre à chaque thème, palette validée
// pour le daltonisme). Toujours accompagnée du libellé du type, jamais seule.
export const KIND_COLOR: Record<Kind, string> = {
  film: "var(--k-film)",
  serie: "var(--k-serie)",
  jeu: "var(--k-jeu)",
  anime: "var(--k-anime)",
  manga: "var(--k-manga)",
  ln: "var(--k-ln)",
  roman: "var(--k-roman)",
};

export const STATUSES = ["en_cours", "prevu", "termine", "pause", "abandonne"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  en_cours: "En cours",
  prevu: "Prévu",
  termine: "Terminé",
  pause: "En pause",
  abandonne: "Abandonné",
};

export function isKind(v: unknown): v is Kind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

export function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

export const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

// Jour courant dans le fuseau de l'appli (NEXT_PUBLIC_TIMEZONE, Paris par défaut), côté navigateur comme côté
// serveur (Vercel tourne en UTC : sans ça, une fin notée après minuit serait datée de la veille).
export const TIMEZONE = process.env.NEXT_PUBLIC_TIMEZONE || "Europe/Paris";
const LOCAL_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export function today(): string {
  return LOCAL_DAY.format(new Date());
}

// Accepte les dates partielles : « 2024-03-12 », « 2024-03 » (mars 2024), « 2024 ».
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "date inconnue";
  const [y, m, d] = iso.split("-").map(Number);
  if (!m) return String(y);
  if (!d) return `${MONTHS[m - 1]} ${y}`;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// Titre réduit à ses lettres et chiffres (toutes écritures), pour comparer « Steins;Gate » et « STEINS;GATE ».
export function normTitle(t: string): string {
  return t.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// Formats AniList, pour nommer les adaptations (« OAV », « Film »…).
export const FORMAT_LABEL: Record<string, string> = {
  TV: "Anime",
  TV_SHORT: "Anime court",
  MOVIE: "Film",
  SPECIAL: "Spécial",
  OVA: "OAV",
  ONA: "ONA",
  MUSIC: "Clip",
  MANGA: "Manga",
  ONE_SHOT: "One-shot",
  NOVEL: "Light novel",
};

// Tris de la bibliothèque.
export const SORTS = {
  note: "Note",
  recent: "Modifié récemment",
  ajout: "Ajouté récemment",
  fin: "Date de fin",
  titre: "Titre",
  sortie: "Année de sortie",
} as const;
export type Sort = keyof typeof SORTS;

// Second critère, à note (ou année…) égale.
export const THEN_SORTS = {
  recent: "Modifié récemment",
  ajout: "Ajouté récemment",
  fin: "Date de fin",
  titre: "Titre",
  sortie: "Année de sortie",
} as const;
export type ThenSort = keyof typeof THEN_SORTS;

export function isThenSort(v: unknown): v is ThenSort {
  return typeof v === "string" && v in THEN_SORTS;
}

export function isSort(v: unknown): v is Sort {
  return typeof v === "string" && v in SORTS;
}

export type Precision = "jour" | "mois" | "annee" | "inconnue";

export function precisionOf(iso: string | null | undefined): Precision {
  if (!iso) return "inconnue";
  return iso.length >= 10 ? "jour" : iso.length >= 7 ? "mois" : "annee";
}

// Relations d'une fiche à son œuvre parente (choisies à la main), et leur sens vu depuis le parent → depuis l'enfant.
export const RELATIONS = [
  "Adaptation", "Remake", "Remaster", "Portage", "Édition", "Suite", "Préquelle", "Spin-off", "Histoire parallèle", "Spécial", "Film", "OAV",
  "Extension", "Version alternative", "Autre",
] as const;
export const RELATION_INVERSE: Record<string, string> = {
  Adaptation: "Source", Remake: "Original", Remaster: "Original", Portage: "Original", "Édition": "Original", Suite: "Préquelle",
  "Préquelle": "Suite", "Spin-off": "Œuvre principale", "Histoire parallèle": "Œuvre principale", "Spécial": "Œuvre principale",
  Film: "Œuvre principale", OAV: "Œuvre principale", Extension: "Jeu de base", "Version alternative": "Version alternative", Autre: "Autre",
};
export function isRelation(v: unknown): v is (typeof RELATIONS)[number] {
  return typeof v === "string" && (RELATIONS as readonly string[]).includes(v);
}

// Favoris du profil : une seule liste, tous types confondus ; le premier porte la couronne.
export const FAV_MAX = 10;

// Identifiant d'une vidéo YouTube (watch?v=, youtu.be, embed, shorts), ou null.
export function youtubeId(url: string): string | null {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url);
  return m?.[1] ?? null;
}
