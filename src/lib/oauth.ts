import type { NextRequest } from "next/server";

// Connexion Discord : cookie d'état anti-falsification et adresse publique de l'appli (pour l'URL de retour).
export const STATE_COOKIE = "almanach_oauth_state";

export function origin(request: NextRequest): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}
