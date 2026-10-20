import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSession } from "@/lib/auth";

// Toute l'appli demande une session (connexion Discord), sauf la page de connexion, les routes de connexion,
// l'API du compagnon Backloggd (authentifiée par son propre jeton) et les fichiers publics.
// Le statut du compte (en attente, membre, admin) est vérifié par les pages elles-mêmes.
export async function proxy(request: NextRequest) {
  if (await readSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return new Response("Connexion requise", { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/connexion";
  url.search = `?suite=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!connexion|en-attente|api/auth|api/compagnon|_next/static|_next/image|manifest.webmanifest|icon|apple-icon|favicon.ico).*)"],
};
