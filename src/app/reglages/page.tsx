import { connection } from "next/server";
import { headers } from "next/headers";
import { all, getSetting } from "@/lib/db";
import type { Kind } from "@/lib/kinds";
import { withCovers } from "@/lib/prefs";
import { companionToken } from "@/lib/auth";
import { listUsers, requireUser } from "@/lib/user";
import { ActionButton, ActionForm } from "@/components/action-button";
import {
  disconnectAnilist, logout, removeUser, runAniList, runAniListPending, runBackloggdReviews, runLetterboxd, runPosters, runSteam,
  saveAccounts, saveSteamKey, setUserStatus,
} from "@/app/actions";
import { pendingAniListCount, pendingBackloggd } from "@/lib/sync";
import { CsvImport } from "./csv-import";
import { MalButton } from "./mal-button";
import { CoverChoice } from "./cover-choice";
import { FavoritesEditor } from "./favorites-editor";

export const metadata = { title: "Réglages" };

function since(iso: string) {
  if (!iso) return "jamais";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">{children}</h2>;
}

export default async function Settings() {
  await connection();
  const me = await requireUser();
  const uid = me.id;
  const [anilistUser, anilistToken, letterboxdUser, backloggdUser, langs, alSync, lbSync, blSync, steamUser, steamKey, steamSync, pseudo, coverSrc] =
    await Promise.all(
      [
        "anilist_user", "anilist_token", "letterboxd_user", "backloggd_user", "mangadex_langs", "anilist_synced_at",
        "letterboxd_synced_at", "backloggd_synced_at", "steam_user", "steam_key", "steam_synced_at", "pseudo", "cover_source",
      ].map((k) => getSetting(uid, k)),
    );
  const clientId = process.env.ANILIST_CLIENT_ID;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const token = await companionToken(uid);
  const pending = await pendingBackloggd(uid);
  const anilistPending = await pendingAniListCount(uid);
  const users = me.status === "admin" ? await listUsers() : [];
  const favorites = (
    await withCovers(
      await all<{ id: number; title: string; cover: string; cover_grid: string; kind: Kind }>(
        "SELECT id, title, cover, cover_grid, kind FROM media WHERE user_id = ? AND fav_rank IS NOT NULL ORDER BY fav_rank",
        [uid],
      ),
    )
  ).map((f) => ({ id: f.id, title: f.title, kind: f.kind, cover: f.cover_grid || f.cover }));

  return (
    <div className="max-w-2xl space-y-14">
      <section>
        <H>Favoris</H>
        <FavoritesEditor initial={favorites} />
      </section>

      <section>
        <H>Comptes</H>
        <ActionForm action={saveAccounts} submit="Enregistrer">
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span>Pseudo AniList</span><input name="anilist_user" defaultValue={anilistUser} className="w-full" /></label>
            <label><span>Pseudo Letterboxd</span><input name="letterboxd_user" defaultValue={letterboxdUser} className="w-full" /></label>
            <label><span>Pseudo Backloggd</span><input name="backloggd_user" defaultValue={backloggdUser} className="w-full" /></label>
            <label><span>Langues de lecture MangaDex</span><input name="mangadex_langs" defaultValue={langs || "fr,en"} className="w-full" /></label>
            <label><span>Pseudo Steam (ou adresse du profil)</span><input name="steam_user" defaultValue={steamUser} className="w-full" /></label>
            <label><span>Pseudo affiché (fil, profil)</span><input name="pseudo" defaultValue={pseudo} placeholder={me.name} className="w-full" /></label>
          </div>
        </ActionForm>
      </section>

      <section className="space-y-4">
        <H>AniList · anime, manga, light novels</H>
        <p className="text-sm text-muted">
          La synchro lit tes listes publiques. Une fois le compte connecté, ce que tu fais dans l’appli (progression, fin, note) est
          aussi écrit sur AniList.
        </p>
        <p className="text-sm">
          {anilistToken ? (
            <>
              Connecté en écriture ({anilistUser}).{" "}
              <ActionButton quiet action={disconnectAnilist} className="text-xs">Déconnecter</ActionButton>
            </>
          ) : clientId ? (
            <a
              className="btn"
              href={`https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&response_type=token`}
            >
              Connecter AniList
            </a>
          ) : (
            <span className="text-muted">
              Pour écrire sur AniList : crée un client sur anilist.co/settings/developer avec comme Redirect URL{" "}
              <code className="text-fg">{origin}/reglages/anilist</code>, puis mets son id dans ANILIST_CLIENT_ID.
            </span>
          )}
        </p>
        <ActionButton action={runAniList}>Synchroniser AniList</ActionButton>
        {anilistPending > 0 && (
          <p className="text-sm">
            {anilistPending} changement{anilistPending > 1 ? "s" : ""} pas encore envoyé{anilistPending > 1 ? "s" : ""} sur AniList (modifications en
            masse, limite de débit d’AniList).{" "}
            <ActionButton quiet action={runAniListPending} className="text-xs">Envoyer</ActionButton>
          </p>
        )}
        <p className="text-xs text-faint">Dernière synchro : {since(alSync)}</p>
      </section>

      <section className="space-y-4">
        <H>Letterboxd · films</H>
        <p className="text-sm text-muted">
          Letterboxd n’ouvre pas son API : on lit ton flux RSS (les ~50 derniers films). Les films se loguent donc sur Letterboxd,
          puis arrivent ici. Pour tout l’historique, importe <code className="text-fg">diary.csv</code> (Letterboxd → Settings → Data → Export).
        </p>
        <ActionButton action={runLetterboxd}>Synchroniser Letterboxd</ActionButton>
        <p className="text-xs text-faint">Dernière synchro : {since(lbSync)}</p>
        <CsvImport />
        <ActionButton quiet action={runPosters}>Compléter les affiches manquantes</ActionButton>
      </section>

      <section className="space-y-4">
        <H>Steam · temps de jeu et succès</H>
        <p className="text-sm text-muted">
          Pour le fil d’activité (« a joué 3 h à … », « a reçu 2 succès sur … »). Steam ne donne plus ces informations sans
          clé : crée-en une gratuitement sur{" "}
          <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer" className="link text-fg">steamcommunity.com/dev/apikey</a>{" "}
          (nom de domaine : n’importe lequel, par exemple localhost). Ton profil et les « détails des jeux » doivent être publics.
        </p>
        <ActionForm action={saveSteamKey} submit="Enregistrer la clé" resetOnSuccess>
          <label className="block max-w-md">
            <span>Clé API Steam {steamKey ? "(déjà enregistrée)" : ""}</span>
            <input name="steam_key" type="password" autoComplete="off" placeholder={steamKey ? "••••••••" : ""} className="w-full" />
          </label>
        </ActionForm>
        <ActionButton action={runSteam}>Synchroniser Steam</ActionButton>
        <p className="text-xs text-faint">
          Dernière synchro : {since(steamSync)}. La première mémorise tes temps de jeu sans rien publier et reprend les succès des 60
          derniers jours ; ensuite, le fil se met à jour tout seul toutes les 10 minutes.
        </p>
      </section>

      <section className="space-y-4">
        <H>Couvertures des anime</H>
        <p className="text-sm text-muted">
          Dans les grilles (bibliothèque, accueil, profils, fil) : la couverture de MyAnimeList, souvent avec le logo, ou celle
          d’AniList. La fiche garde toujours celle d’AniList.
        </p>
        <CoverChoice value={coverSrc === "anilist" ? "anilist" : "mal"} />
        {coverSrc !== "anilist" && (
          <>
            <p className="text-sm text-muted">Celles de MyAnimeList se récupèrent par lots à chaque synchro AniList, ou d’un coup ici.</p>
            <MalButton />
          </>
        )}
      </section>

      <section className="space-y-4">
        <H>Backloggd · jeux</H>
        <p className="text-sm text-muted">
          Backloggd n’a pas d’API et filtre les robots : la synchro passe par un petit compagnon lancé sur ton PC, qui pilote ton
          navigateur (Edge ou Chrome) comme le fait Apploggd. Il lit ton journal (sessions, fins, notes) et tes listes Backlog
          (→ Prévu) et Playing (→ En cours), puis écrit dans le journal les jeux que tu termines ici.
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>
            Dans le dossier de l’appli, crée <code className="text-fg">.env.local</code> avec <code className="text-fg">ALMANACH_URL={origin}</code> et{" "}
            <code className="text-fg">ALMANACH_TOKEN={token}</code>
          </li>
          <li>
            Première fois : <code className="text-fg">npm run backloggd -- login</code> (une fenêtre s’ouvre, connecte-toi à Backloggd)
          </li>
          <li>
            Ensuite : <code className="text-fg">npm run backloggd</code> (lecture du journal + envoi des fins)
          </li>
        </ol>
        <p className="text-sm">
          {pending.length
            ? `${pending.length} fin${pending.length > 1 ? "s" : ""} en attente d’envoi : ${pending.map((p) => p.title).join(", ")}`
            : "Aucune fin en attente d’envoi."}
        </p>
        <p className="text-xs text-faint">Dernière lecture du journal : {since(blSync)}</p>
        <p className="text-sm text-muted">
          Tes critiques Backloggd récentes (et leurs notes) se lisent directement, sans le compagnon, depuis le flux public de ton
          profil.
        </p>
        <ActionButton quiet action={runBackloggdReviews}>Importer mes critiques Backloggd</ActionButton>
      </section>

      {users.length > 0 && (
        <section className="space-y-3">
          <H>Membres</H>
          <p className="text-sm text-muted">
            Toute personne qui se connecte avec Discord crée un compte en attente : ouvre-lui l’accès ici. Retirer un compte efface
            aussi ses données.
          </p>
          <ul className="divide-y divide-line">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-2.5">
                {u.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.avatar} alt="" className="size-7 rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="size-7 rounded-full bg-raised" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {u.name || "(pas encore connecté)"}
                  <span className="text-muted"> · {u.status === "admin" ? "admin" : u.status === "member" ? "membre" : "en attente"}</span>
                </span>
                {u.status === "pending" && <ActionButton action={setUserStatus.bind(null, u.id, "member")} className="text-xs">Ouvrir l’accès</ActionButton>}
                {u.status === "member" && <ActionButton quiet action={setUserStatus.bind(null, u.id, "admin")} className="text-xs">Rendre admin</ActionButton>}
                {u.id !== me.id && (
                  <ActionButton quiet action={removeUser.bind(null, u.id)} confirm={`Retirer ${u.name} et toutes ses données ?`} className="text-xs">
                    Retirer
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <H>Session</H>
        <p className="mb-3 text-sm text-muted">Connecté avec Discord en tant que {me.name}.</p>
        <form action={logout}>
          <button className="btn-quiet">Se déconnecter</button>
        </form>
      </section>
    </div>
  );
}
