"use client";

import { usePathname } from "next/navigation";

// Zone principale : largeur limitée partout, sauf l'accueil qui gère lui-même ses colonnes (fil d'activité à
// gauche sur grand écran, contenu élargi et centré à droite) et les fiches.
export function Main({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  // Les fiches (bannière pleine largeur, comme AniList) gèrent aussi leur largeur.
  const wide = path === "/" || path.startsWith("/media/");
  return <main className={`${wide ? "" : "mx-auto max-w-6xl"} px-4 pt-6 pb-28 sm:px-6 sm:pb-16`}>{children}</main>;
}
