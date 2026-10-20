import { NextResponse, type NextRequest } from "next/server";
import { signState } from "@/lib/auth";
import { STATE_COOKIE, origin } from "@/lib/oauth";

// Connexion Discord (OAuth2, code d'autorisation) : redirige vers Discord avec un état anti-falsification.
export async function GET(request: NextRequest) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return new Response("DISCORD_CLIENT_ID manquant.", { status: 500 });
  const state = await signState(crypto.randomUUID());
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", `${origin(request)}/api/auth/discord/callback`);
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "none");
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  const next = request.nextUrl.searchParams.get("suite");
  if (next?.startsWith("/") && !next.startsWith("//")) res.cookies.set("almanach_next", next, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
