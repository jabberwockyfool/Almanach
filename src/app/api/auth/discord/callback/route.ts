import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_DAYS, checkState, signSession } from "@/lib/auth";
import { loginDiscord } from "@/lib/user";
import { STATE_COOKIE, origin } from "@/lib/oauth";

// Retour de Discord : échange le code contre un jeton, lit le profil, ouvre la session.
export async function GET(request: NextRequest) {
  const base = origin(request);
  const fail = (why: string) => NextResponse.redirect(`${base}/connexion?erreur=${encodeURIComponent(why)}`);
  const sp = request.nextUrl.searchParams;
  if (sp.get("error")) return fail("Connexion Discord annulée.");
  if (!(await checkState(sp.get("state"), request.cookies.get(STATE_COOKIE)?.value))) return fail("Lien de connexion expiré, recommence.");
  const code = sp.get("code");
  if (!code) return fail("Discord n’a pas renvoyé de code.");

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID ?? "",
      client_secret: process.env.DISCORD_CLIENT_SECRET ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: `${base}/api/auth/discord/callback`,
    }),
    cache: "no-store",
  });
  if (!tokenRes.ok) return fail(`Discord a refusé la connexion (${tokenRes.status}).`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const meRes = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${access_token}` }, cache: "no-store" });
  if (!meRes.ok) return fail("Profil Discord illisible.");
  const me = (await meRes.json()) as { id: string; username: string; global_name: string | null; avatar: string | null };

  const user = await loginDiscord({
    id: me.id,
    name: me.global_name || me.username,
    avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128` : "",
  });
  const next = request.cookies.get("almanach_next")?.value;
  const res = NextResponse.redirect(`${base}${user.status === "pending" ? "/en-attente" : next && next.startsWith("/") ? next : "/"}`);
  res.cookies.set(SESSION_COOKIE, await signSession(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 86400,
    path: "/",
  });
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete("almanach_next");
  return res;
}
