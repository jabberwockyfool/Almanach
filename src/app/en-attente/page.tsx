import { redirect } from "next/navigation";
import { connection } from "next/server";
import { currentUser } from "@/lib/user";
import { logout } from "@/app/actions";

export const metadata = { title: "En attente" };

// Compte créé mais pas encore approuvé par un admin.
export default async function Pending() {
  await connection();
  const user = await currentUser();
  if (!user) redirect("/connexion");
  if (user.status !== "pending") redirect("/");
  return (
    <div className="mx-auto mt-24 max-w-sm space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Presque !</h1>
      <p className="text-muted">
        Ton compte ({user.name}) est créé. Almanach est réservé à un petit groupe : un admin doit encore t’ouvrir l’accès. Reviens
        un peu plus tard.
      </p>
      <form action={logout}>
        <button className="btn-quiet">Se déconnecter</button>
      </form>
    </div>
  );
}
