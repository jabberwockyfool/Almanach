"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { saveAnilistToken } from "@/app/actions";

// Retour de l'autorisation AniList (« implicit grant ») : le jeton arrive dans le fragment de l'adresse,
// invisible du serveur, d'où cette page client qui le transmet.
export default function AnilistCallback() {
  const [text, setText] = useState("Connexion à AniList…");
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("access_token");
    history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setText("AniList n’a pas renvoyé de jeton.");
      return;
    }
    saveAnilistToken(token).then((r) => setText(r.text));
  }, []);
  return (
    <div className="space-y-4">
      <p>{text}</p>
      <Link href="/reglages" className="link">Retour aux réglages</Link>
    </div>
  );
}
