import type { MetadataRoute } from "next";

// Installable sur téléphone (« Ajouter à l'écran d'accueil ») et sur PC (Edge/Chrome → Installer).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Almanach",
    short_name: "Almanach",
    description: "Films, séries, jeux, anime, manga et light novels : suivi et récap de l'année.",
    start_url: "/",
    display: "standalone",
    background_color: "#111214",
    theme_color: "#111214",
    lang: "fr",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
