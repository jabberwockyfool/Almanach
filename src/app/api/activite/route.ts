import { after, type NextRequest } from "next/server";
import { feed, refreshSources } from "@/lib/activity";
import { currentUser } from "@/lib/user";

// Fil d'activité de l'accueil, chargé à part pour ne pas ralentir la page.
// Les imports AniList / Steam du compte tournent après la réponse : leurs résultats arrivent au rafraîchissement suivant.
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user || user.status === "pending") return new Response("Connexion requise", { status: 401 });
  const sp = request.nextUrl.searchParams;
  // « avant=heure.id » : le dernier événement déjà affiché.
  const [at, id] = (sp.get("avant") ?? "").split(".").map(Number);
  const before = at && id ? { at, id } : null;
  after(() => refreshSources(user.id).catch(() => {}));
  return Response.json(await feed(user.id, sp.get("portee") === "moi" ? "moi" : "tous", before));
}
