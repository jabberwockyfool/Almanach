import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSession } from "@/lib/auth";
import { all, get, run, type User } from "@/lib/db";

// Compte connecté pour la requête en cours (lu une fois par requête).
export const currentUser = cache(async (): Promise<User | null> => {
  const id = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!id) return null;
  return (await get<User>("SELECT * FROM users WHERE id = ?", [id])) ?? null;
});

// Pages et actions : un compte approuvé est obligatoire. Renvoie son id.
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/connexion");
  if (user.status === "pending") redirect("/en-attente");
  return user;
}

export async function requireUid(): Promise<number> {
  return (await requireUser()).id;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.status !== "admin") throw new Error("Réservé aux admins.");
  return user;
}

export async function getUser(id: number): Promise<User | undefined> {
  return get<User>("SELECT * FROM users WHERE id = ?", [id]);
}

export async function listUsers(): Promise<User[]> {
  return all<User>("SELECT * FROM users ORDER BY status = 'pending' DESC, created_at");
}

// Connexion Discord : retrouve le compte, ou le crée. Le compte n°1 (données d'avant les comptes) revient au
// premier qui se connecte, ou à DISCORD_OWNER_ID s'il est défini. Les autres attendent l'accord d'un admin,
// sauf s'ils figurent dans DISCORD_ALLOWED_IDS.
export async function loginDiscord(d: { id: string; name: string; avatar: string }): Promise<User> {
  const known = await get<User>("SELECT * FROM users WHERE discord_id = ?", [d.id]);
  if (known) {
    await run("UPDATE users SET name = ?, avatar = ?, last_seen = datetime('now') WHERE id = ?", [d.name, d.avatar, known.id]);
    return (await getUser(known.id))!;
  }
  const owner = process.env.DISCORD_OWNER_ID;
  const unclaimed = await get<User>("SELECT * FROM users WHERE discord_id IS NULL AND status = 'admin' ORDER BY id LIMIT 1");
  if (unclaimed && (!owner || owner === d.id)) {
    await run("UPDATE users SET discord_id = ?, name = ?, avatar = ?, last_seen = datetime('now') WHERE id = ?", [d.id, d.name, d.avatar, unclaimed.id]);
    return (await getUser(unclaimed.id))!;
  }
  const anyAdmin = await get("SELECT id FROM users WHERE status = 'admin' AND discord_id IS NOT NULL");
  const allowed = (process.env.DISCORD_ALLOWED_IDS ?? "").split(/[\s,]+/).filter(Boolean);
  const status = !anyAdmin || owner === d.id ? "admin" : allowed.includes(d.id) ? "member" : "pending";
  const { id } = await run("INSERT INTO users (discord_id, name, avatar, status, last_seen) VALUES (?, ?, ?, ?, datetime('now'))", [
    d.id,
    d.name,
    d.avatar,
    status,
  ]);
  return (await getUser(id))!;
}
