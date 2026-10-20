import type { NextRequest } from "next/server";

// Relais d'images pour l'export PNG du récap : une image d'un autre domaine « teinte » le canvas et
// bloque l'export, la même image servie par l'appli non. Réservé aux images, derrière la connexion (proxy.ts).
export async function GET(request: NextRequest) {
  const u = request.nextUrl.searchParams.get("u") ?? "";
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return new Response("Adresse invalide", { status: 400 });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return new Response("Adresse invalide", { status: 400 });
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Almanach/0.1)" } }).catch(() => null);
  const type = res?.headers.get("content-type") ?? "";
  if (!res?.ok || !type.startsWith("image/")) return new Response("Image introuvable", { status: 502 });
  return new Response(res.body, {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=604800" },
  });
}
