# Almanach

Suivi de médias pour un petit groupe d'amis : films, séries, jeux, anime, manga, light novels et romans.
Calendrier des œuvres terminées dans l'année, récap façon « Wrapped », fil d'activité commun, fiches façon
AniList. Appli web Next.js installable sur PC et téléphone (PWA), données dans une base libSQL (fichier local
ou Turso), connexion par Discord.

- **Bibliothèque** en grille façon Backloggd : étoiles au quart, critiques et « j'aime », adaptations, OAV et
  films rangés sous leur œuvre d'origine, séries de light novels regroupées, tri à deux critères.
- **Fiches** façon AniList : bannière, infos, éditeurs par langue (fan-trads comprises), relations (adaptation,
  remake, préquelle, suite…), personnages, openings jouables, ce qu'en pense le groupe.
- **Synchro** AniList, Letterboxd, Backloggd (via un compagnon local), Steam, MangaDex (lecteur intégré).
- **Année et récap** : calendrier des fins, dates partielles (mois, année, inconnue), récap partageable.
- **Groupe** : un compte par personne (Discord), fiches privées, favoris, profils, fil « Tout le monde / Moi ».

## Démarrer

Prérequis : Node.js 20 ou plus.

```bash
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

Dans `.env.local`, le minimum :

1. `APP_SECRET` : une longue chaîne aléatoire (`node -e "console.log(crypto.randomBytes(32).toString('base64url'))"`).
2. Une application Discord (<https://discord.com/developers/applications>) → OAuth2 :
   `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, et dans **Redirects**
   `http://localhost:3000/api/auth/discord/callback`.

Sans `TURSO_DATABASE_URL`, la base est le fichier `data/almanach.db` (créé au premier lancement).
La première personne qui se connecte devient administratrice ; les suivantes attendent son accord
(Réglages → Membres).

## Déployer sur Vercel

1. Importer le dépôt dans Vercel.
2. Ajouter une base Turso depuis le Marketplace Vercel (Storage → Turso) : elle crée `TURSO_DATABASE_URL`
   et `TURSO_AUTH_TOKEN`.
3. Variables du projet : `APP_SECRET`, `APP_URL` (adresse publique, ex. `https://mon-almanach.vercel.app`),
   `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, puis les clés facultatives ci-dessous.
4. Dans Discord, ajouter le redirect `<APP_URL>/api/auth/discord/callback`.

Pour reprendre une base locale déjà remplie (relançable, rien n'est dupliqué) :

```bash
vercel env pull prod.env --environment production
node --env-file=prod.env scripts/push-to-turso.mjs   # puis supprimer prod.env
```

## Variables d'environnement

| Variable | | Rôle |
|---|---|---|
| `APP_SECRET` | requis | Signe les sessions et les jetons du compagnon (le même en local et en ligne). |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | requis | Connexion. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | en ligne | Base distante (obligatoire sur Vercel). |
| `APP_URL` | conseillé | Adresse publique, pour l'adresse de retour Discord. |
| `NEXT_PUBLIC_TIMEZONE` | | Fuseau des dates « aujourd'hui » (`Europe/Paris` par défaut). |
| `DISCORD_OWNER_ID` | | Qui devient administrateur (sinon : la première connexion). |
| `DISCORD_ALLOWED_IDS` | | Identifiants Discord acceptés d'office, séparés par des virgules. |
| `ANILIST_CLIENT_ID` | | Écriture sur AniList (client AniList, redirect `<APP_URL>/reglages/anilist`). |
| `TMDB_TOKEN` | | Recherche et fiches de films (clé v3 ou jeton « Read Access »). |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | | IGDB : bannières, infos, séries et temps de jeu des jeux (appli sur dev.twitch.tv). |
| `STEAMGRIDDB_KEY` | | Jaquettes et bannières de jeux SteamGridDB. |
| `STEAM_API_KEY` | | Clé Steam commune (sinon chacun la saisit dans Réglages). |
| `GOOGLE_BOOKS_KEY` | | Google Books en plus d'Open Library pour les romans. |
| `ALMANACH_URL`, `ALMANACH_TOKEN`, `BACKLOGGD_BROWSER` | | Compagnon Backloggd (voir plus bas). |

## Sources

| Type | Ajout | Synchro | Fiche |
|---|---|---|---|
| Anime, manga, LN | AniList | Listes AniList (pseudo public), écriture si connecté | AniList, animethemes.moe |
| Films | TMDB | Letterboxd : flux RSS + import `diary.csv` | TMDB |
| Séries | TVmaze | Dans l'appli | TVmaze |
| Jeux | Steam | Backloggd (compagnon), Steam (temps de jeu, succès) | IGDB, Steam, VNDB (visual novels), Wikidata (préquelle / suite), PCGamingWiki (fan-trads FR) |
| Romans | Open Library (titre ou ISBN) | Dans l'appli | Open Library |

Les fiches des sources sont mises en cache dans la table `info_cache`, commune à tous les comptes.

## Fonctionnement

- **Ajouter** : un résultat de recherche ouvre un menu façon AniList (statut, note, progression, dates, notes,
  « j'aime », privé, relation à une autre œuvre). Le même menu modifie une fiche (bouton de statut sous la
  couverture). Une fin datée d'aujourd'hui est publiée dans le fil ; une date passée l'ajoute sans la publier.
- **Une page par œuvre** : la fiche d'un ami renvoie vers la sienne si on a l'œuvre ; sinon elle se présente
  comme la page de l'œuvre, avec « Ajouter » et l'avis de chacun dans « Le groupe ».
- **Relations** : automatiques (AniList, VNDB, titres, IGDB, Wikidata) ou choisies à la main avec leur type
  (Adaptation, Remake, Suite…), vues dans les deux sens (Remake ↔ Original).
- **Favoris** : une liste commune à tous les types (10 au plus, le premier couronné), réordonnable dans Réglages.
- **Fil d'activité** : progression, fins, statuts, sessions Backloggd, temps de jeu et succès Steam. Les notes
  seules n'y vont pas ; chacun peut retirer ses activités (×).
- **Dates de fin** au jour, au mois, à l'année ou inconnues ; corrections en masse depuis le calendrier.
- **Romans** suivis à la page ; **manga** lisibles via MangaDex ; liens « où regarder » dans une visionneuse.
- **Couvertures des anime** dans les grilles : MyAnimeList (avec logo) ou AniList, au choix dans Réglages.

## Compagnon Backloggd

Backloggd n'a pas d'API et filtre les robots (Anubis/BotStopper). Comme
[Apploggd](https://github.com/nik250dev/apploggd), le compagnon pilote Edge ou Chrome via playwright-core,
dans une vraie fenêtre réduite (le mode headless est refusé par le site). Il lit le journal, les listes
(Backlog, Playing, Played par statut, aimés, favoris) et les critiques, et écrit dans le journal les fins
faites dans l'appli.

```bash
# .env.local : ALMANACH_URL (adresse de l'appli) et ALMANACH_TOKEN (jeton affiché dans Réglages)
npm run backloggd -- login              # une fois : se connecter à Backloggd dans la fenêtre
npm run backloggd                       # lit (3 pages de journal) puis écrit les fins en attente
npm run backloggd -- pull --pages=200   # tout l'historique, en lecture seule
```

Options : `pull` / `push` seuls, `--visible`, `--pages=N`, `--user=pseudo` (profil public d'un autre membre,
avec son jeton), `--debug`.

## Code

- `src/app` : pages (App Router) et actions serveur (`actions.ts`).
- `src/lib` : base (`db.ts`, migrations au démarrage), synchros (`sync.ts`, `activity.ts`, `steam.ts`…),
  fiches des sources (`info.ts`), regroupements (`groups.ts`), fil (`events.ts`), statistiques (`stats.ts`).
- `scripts/backloggd.mjs` : compagnon ; `scripts/push-to-turso.mjs` : copie d'une base locale vers Turso.

```bash
npm run typecheck
npm run build
```
