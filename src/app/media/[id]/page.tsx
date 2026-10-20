import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { all, get, type Link as MediaLink, type Log, type Media } from "@/lib/db";
import { FORMAT_LABEL, KIND_COLOR, KIND_LABEL, KIND_UNIT, RELATION_INVERSE, STATUSES, STATUS_LABEL, normTitle, youtubeId } from "@/lib/kinds";
import { groupAdaptations } from "@/lib/groups";
import { emptyInfo, flagOf, getInfo, type Company, type SeriesGame } from "@/lib/info";
import { getUser, requireUser } from "@/lib/user";
import { Cover } from "@/components/cover";
import { ActionButton, ActionForm } from "@/components/action-button";
import { DateFields } from "@/components/date-fields";
import { RateButton, Stars } from "@/components/stars";
import { FinishFields } from "@/components/finish-fields";
import { PageField } from "@/components/page-field";
import {
  addAlias, addLink, addTheme, deleteLink, deleteLog, finishMedia, removeAlias, removeMedia, setFavorite, setLogDate, setLogRating,
  setMangadex, setPrivate, setRating, setReview, stepProgress, updateMedia,
} from "@/app/actions";
import { MangadexLinker } from "./mangadex-linker";
import { CoverEditor } from "./cover-editor";
import { StatusButton } from "./status-button";
import { ParentPicker } from "./parent-picker";
import { InfoEditor } from "./info-editor";
import { BannerEditor } from "./banner-editor";
import { Clamp, LimitedGrid, TagList, ThemeList, type ThemeRow } from "./parts";
import { withCovers } from "@/lib/prefs";

export async function generateMetadata({ params }: PageProps<"/media/[id]">) {
  const m = await get<Media>("SELECT title FROM media WHERE id = ?", [Number((await params).id)]);
  return { title: m?.title ?? "Média" };
}

function externalLinks(m: Media) {
  const out: [string, string][] = [];
  if (m.anilist_id) out.push(["AniList", `https://anilist.co/${m.kind === "anime" ? "anime" : "manga"}/${m.anilist_id}`]);
  if (m.mal_id) out.push(["MyAnimeList", `https://myanimelist.net/anime/${m.mal_id}`]);
  if (m.letterboxd_slug && !m.letterboxd_slug.startsWith("?")) out.push(["Letterboxd", `https://letterboxd.com/film/${m.letterboxd_slug}/`]);
  if (m.backloggd_slug) out.push(["Backloggd", `https://backloggd.com/games/${m.backloggd_slug}/`]);
  if (m.vndb_id && m.vndb_id !== "-") out.push(["VNDB", `https://vndb.org/${m.vndb_id}`]);
  if (m.tvmaze_id) out.push(["TVmaze", `https://www.tvmaze.com/shows/${m.tvmaze_id}`]);
  if (m.tmdb_id && m.kind === "film") out.push(["TMDB", `https://www.themoviedb.org/movie/${m.tmdb_id}`]);
  if (m.steam_id) out.push(["Steam", `https://store.steampowered.com/app/${m.steam_id}/`]);
  if (m.mangadex_id) out.push(["MangaDex", `https://mangadex.org/title/${m.mangadex_id}`]);
  if (m.isbn) out.push(["Open Library", `https://openlibrary.org/isbn/${m.isbn}`]);
  return out;
}

function FinishForm({ m }: { m: Media }) {
  return (
    <ActionForm action={finishMedia.bind(null, m.id)} submit="Enregistrer" className="mt-3 max-w-md">
      <FinishFields rating={m.rating} isGame={m.kind === "jeu"} />
    </ActionForm>
  );
}

const SOURCE_LABEL: Record<string, string> = { app: "", anilist: "AniList", letterboxd: "Letterboxd", backloggd: "Backloggd" };

// Relation d'une fiche de la bibliothèque à celle-ci : « Source », « Adaptation », ou le format d'un à-côté.
// Une relation choisie à la main (« Remake »…) l'emporte : telle quelle sur l'enfant, inversée vers le parent.
function familyLabel(child: Media, parent: Media, childIsThis: boolean): string {
  if (child.parent_relation) return childIsThis ? (RELATION_INVERSE[child.parent_relation] ?? "Autre") : child.parent_relation;
  if (childIsThis) return parent.kind === child.kind ? "Œuvre principale" : "Source";
  if (child.kind === parent.kind && child.kind === "anime") {
    return { MOVIE: "Film", OVA: "OAV", SPECIAL: "Spécial", MUSIC: "Clip", ONA: "Spécial" }[child.format ?? ""] ?? "Histoire parallèle";
  }
  return child.kind === parent.kind ? "Histoire parallèle" : "Adaptation";
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">{children}</h2>;
}

type Card = { key: string; label: string; title: string; cover: string; sub: React.ReactNode; href: string; external: boolean };

// Carte de relation façon AniList : couverture à gauche, type de relation en couleur, titre, format et statut.
function RelationCard({ c }: { c: Card }) {
  const body = (
    <>
      <span className="w-[72px] shrink-0">
        <Cover src={c.cover} title={c.title} className="h-full rounded-none" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col py-2 pr-3">
        <span className="text-xs font-medium text-accent">{c.label}</span>
        <span className="mt-0.5 line-clamp-2 text-sm leading-snug">{c.title}</span>
        <span className="mt-auto pt-1 text-xs text-muted">{c.sub}</span>
      </span>
    </>
  );
  const cls = "flex h-[104px] gap-3 overflow-hidden rounded-md bg-raised hover:ring-1 hover:ring-line";
  return c.external ? (
    <a href={c.href} target="_blank" rel="noreferrer" className={cls}>{body}</a>
  ) : (
    <Link href={c.href} className={cls}>{body}</Link>
  );
}

// Jeux d'une série IGDB : la fiche de la bibliothèque s'il y en a une, sinon la page IGDB.
function SeriesGrid({ games, own }: { games: SeriesGame[]; own: Map<string, Media> }) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
      {games.map((g) => {
        const mine = own.get(normTitle(g.name));
        const body = (
          <>
            <Cover src={mine ? mine.cover_grid || mine.cover : g.cover} title={g.name} className={mine ? "" : "opacity-80"} />
            <p className="mt-1 line-clamp-2 text-xs">{g.name}</p>
            <p className="text-[0.7rem] text-faint">
              {mine ? (mine.rating != null ? <Stars value={mine.rating} size={10} /> : STATUS_LABEL[mine.status]) : [g.year, g.type].filter(Boolean).join(" · ")}
            </p>
          </>
        );
        return mine ? (
          <Link key={g.name} href={`/media/${mine.id}`} className="min-w-0">{body}</Link>
        ) : (
          <a key={g.name} href={g.url} target="_blank" rel="noreferrer" className="min-w-0">{body}</a>
        );
      })}
    </div>
  );
}

// Colonne d'infos : sociétés par rôle ; éditeurs par langue avec drapeau, fan-trads en italique (comme VNDB).
const ROLE_ORDER = ["Auteur", "Scénario", "Dessin", "Réalisation", "Studio", "Développeur", "Éditeur", "Production", "Diffuseur"];
function Companies({ list }: { list: Company[] }) {
  const roles = [...new Set(list.map((c) => c.role))].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
  return (
    <>
      {roles.map((role) => {
        const of = list.filter((c) => c.role === role);
        const langs = [...new Set(of.map((c) => c.lang ?? ""))];
        return (
          <div key={role}>
            <dt className="text-sm font-medium">{role === "Éditeur" && of.length > 1 ? "Éditeurs" : role === "Développeur" && of.length > 1 ? "Développeurs" : role}</dt>
            {langs.map((lang) => (
              <dd key={lang} className="flex gap-1.5 text-sm text-muted">
                {flagOf(lang) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={flagOf(lang)!} alt={lang} title={lang} className="mt-1 h-[11px] w-[15px] shrink-0 rounded-[1px] object-cover" />
                )}
                <span>
                  {of
                    .filter((c) => (c.lang ?? "") === lang)
                    .map((c, i) => (
                      <span key={c.name}>
                        {i > 0 && " & "}
                        {c.url ? (
                          <a href={c.url} target="_blank" rel="noreferrer" className={`link ${c.fan ? "italic" : ""}`} title={c.fan ? "Traduction de fans" : undefined}>{c.name}</a>
                        ) : (
                          <span className={c.fan ? "italic" : ""} title={c.fan ? "Traduction de fans" : undefined}>{c.name}</span>
                        )}
                      </span>
                    ))}
                </span>
              </dd>
            ))}
          </div>
        );
      })}
    </>
  );
}

export default async function MediaPage({ params }: PageProps<"/media/[id]">) {
  await connection();
  const me = await requireUser();
  const id = Number((await params).id);
  const m = await get<Media>("SELECT * FROM media WHERE id = ?", [id]);
  if (!m) notFound();
  const owner = m.user_id === me.id ? me : await getUser(m.user_id);
  if (!owner || owner.status === "pending") notFound();
  // Fiche d'un autre compte : lecture seule, et introuvable si elle est privée.
  const editable = owner.id === me.id;
  if (!editable && m.private) notFound();
  // Une seule page par œuvre : si on l'a aussi, on va sur sa propre fiche (celle des autres y est dans « Le groupe »).
  if (!editable) {
    const mine = await get<{ id: number }>(
      `SELECT id FROM media WHERE user_id = ? AND kind = ? AND (
         (anilist_id IS NOT NULL AND anilist_id = ?) OR (steam_id IS NOT NULL AND steam_id = ?) OR (tmdb_id IS NOT NULL AND tmdb_id = ?)
         OR (tvmaze_id IS NOT NULL AND tvmaze_id = ?) OR (isbn IS NOT NULL AND isbn = ?) OR (backloggd_slug IS NOT NULL AND backloggd_slug = ?)
         OR lower(title) = lower(?)) LIMIT 1`,
      [me.id, m.kind, m.anilist_id, m.steam_id, m.tmdb_id, m.tvmaze_id, m.isbn, m.backloggd_slug, m.title],
    );
    if (mine) redirect(`/media/${mine.id}`);
  }

  const [logs, links, userAliases, userThemes, library] = await Promise.all([
    all<Log>("SELECT * FROM log WHERE media_id = ? ORDER BY finished_on IS NULL, finished_on DESC, id DESC", [id]),
    editable ? all<MediaLink>("SELECT * FROM link WHERE media_id = ? ORDER BY position", [id]) : Promise.resolve([] as MediaLink[]),
    all<{ title: string }>("SELECT title FROM title_alias WHERE media_id = ? ORDER BY title", [id]),
    all<{ id: number; type: string; title: string; url: string }>("SELECT * FROM theme WHERE media_id = ? ORDER BY type, id", [id]),
    all<Media>(`SELECT * FROM media WHERE user_id = ?${editable ? "" : " AND private = 0"}`, [owner.id]).then(withCovers),
  ]);
  const unit = KIND_UNIT[m.kind];
  const canRead = m.kind === "manga";

  // Rangement de la bibliothèque du compte : adaptations, série fusionnée, parent.
  const family = await groupAdaptations(library);
  const byId = new Map(library.map((x) => [x.id, x]));
  const seriesHead = Object.entries(family.series).find(([, s]) => s.members.includes(m.id));
  const series = seriesHead?.[1];
  const seriesMembers = series ? series.members.map((x) => byId.get(x)!).filter(Boolean).sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.id - b.id) : [];
  const anchor = seriesHead ? Number(seriesHead[0]) : m.id;
  const parentId = family.parentOf[anchor] ?? (m.parent_override || undefined);
  const parent = parentId ? byId.get(parentId) : undefined;
  const kids = (family.children[anchor] ?? []).filter((k) => family.parentOf[k.id] === anchor);
  // Fiche des sources ; pour un jeu, ses adaptations anime/manga de la bibliothèque donnent les personnages.
  const related = [...kids, ...(parent ? [parent] : [])]
    .filter((x) => x.anilist_id && (x.kind === "anime" || x.kind === "manga"))
    .sort((a, b) => Number(b.kind === "anime") - Number(a.kind === "anime"))
    .map((x) => x.anilist_id!);
  const info = await getInfo(m, related).catch(emptyInfo);
  // Jeux de la bibliothèque, pour relier les jeux de la série à leur fiche.
  const ownGames = new Map(library.filter((x) => x.kind === "jeu").map((x) => [normTitle(x.title), x]));

  // Relations : celles de la bibliothèque (y compris VN, jeux et rattachements à la main), puis celles d'AniList.
  const statusSub = (x: Media) => (
    <>
      {FORMAT_LABEL[x.format ?? ""] ?? KIND_LABEL[x.kind]} · {x.rating != null ? <Stars value={x.rating} size={10} /> : STATUS_LABEL[x.status]}
    </>
  );
  const cards: Card[] = [];
  if (parent) cards.push({ key: `m${parent.id}`, label: familyLabel(m, parent, true), title: parent.title, cover: parent.cover_grid || parent.cover, sub: statusSub(parent), href: `/media/${parent.id}`, external: false });
  for (const k of kids) cards.push({ key: `m${k.id}`, label: familyLabel(k, m, false), title: k.title, cover: k.cover_grid || k.cover, sub: statusSub(k), href: `/media/${k.id}`, external: false });
  const inCards = new Set([parent, ...kids].map((x) => x?.anilist_id).filter(Boolean));
  const ownedByAl = new Map(library.filter((x) => x.anilist_id).map((x) => [x.anilist_id!, x]));
  for (const r of info.relations) {
    if (inCards.has(r.anilistId)) continue;
    const own = ownedByAl.get(r.anilistId);
    cards.push({
      key: `a${r.anilistId}`,
      label: r.label,
      title: own?.title ?? r.title,
      cover: own ? own.cover_grid || own.cover : r.cover,
      sub: own ? statusSub(own) : r.sub,
      href: own ? `/media/${own.id}` : `https://anilist.co/${r.type.toLowerCase()}/${r.anilistId}`,
      external: !own,
    });
  }
  // Jeux : la préquelle et la suite directes (Wikidata) et les versions du même jeu (« Original », « Remake »…) en
  // cartes ; les autres jeux de la série restent repliés sous les relations.
  const inTitles = new Set(cards.map((c) => normTitle(c.title)));
  const [mainSeries, wideSeries] = info.gameSeries;
  const gameCards = [...info.gameRelations, ...(mainSeries?.games ?? []).filter((g) => g.relation !== "Même série")];
  for (const g of gameCards) {
    if (inTitles.has(normTitle(g.name))) continue;
    inTitles.add(normTitle(g.name));
    const own = ownGames.get(normTitle(g.name));
    cards.push({
      key: `s${g.name}`,
      label: g.relation,
      title: own?.title ?? g.name,
      cover: own ? own.cover_grid || own.cover : g.cover,
      sub: own ? statusSub(own) : [g.year, g.type].filter(Boolean).join(" · ") || "Jeu",
      href: own ? `/media/${own.id}` : g.url,
      external: !own,
    });
  }
  const moreGames = [...(mainSeries?.games ?? []), ...(wideSeries?.games ?? [])].filter((g) => {
    const k = normTitle(g.name);
    if (inTitles.has(k)) return false;
    inTitles.add(k);
    return true;
  });
  const seriesName = wideSeries?.name ?? mainSeries?.name ?? "";
  const ORDER = ["Source", "Original", "Œuvre principale", "Jeu de base", "Adaptation", "Remake", "Remaster", "Version étendue", "Préquelle", "Suite"];
  cards.sort((a, b) => (ORDER.indexOf(a.label) + 1 || 99) - (ORDER.indexOf(b.label) + 1 || 99));

  // Le groupe : les autres comptes qui ont cette œuvre (hors fiches privées).
  const friends = await all<{ id: number; status: Media["status"]; rating: number | null; liked: number; review: string; uid: number; name: string; avatar: string; pseudo: string | null }>(
    `SELECT media.id, media.status, media.rating, media.liked, media.review, users.id AS uid, users.name, users.avatar,
            (SELECT value FROM user_setting WHERE user_id = users.id AND key = 'pseudo') AS pseudo
     FROM media JOIN users ON users.id = media.user_id
     WHERE media.id <> ? AND users.status <> 'pending' AND media.private = 0 AND media.kind = ? AND (
       (media.anilist_id IS NOT NULL AND media.anilist_id = ?) OR (media.steam_id IS NOT NULL AND media.steam_id = ?)
       OR (media.tmdb_id IS NOT NULL AND media.tmdb_id = ?) OR (media.tvmaze_id IS NOT NULL AND media.tvmaze_id = ?)
       OR (media.isbn IS NOT NULL AND media.isbn = ?) OR (media.backloggd_slug IS NOT NULL AND media.backloggd_slug = ?)
       OR lower(media.title) = lower(?))
     ORDER BY media.status = 'termine' DESC, media.rating DESC`,
    // Sur la page d'une œuvre qu'on n'a pas, son propriétaire figure aussi dans le groupe.
    [editable ? m.id : 0, m.kind, m.anilist_id, m.steam_id, m.tmdb_id, m.tvmaze_id, m.isbn, m.backloggd_slug, m.title],
  );

  const themes: ThemeRow[] = [
    ...info.themes.map((t, i) => ({ key: `at${i}`, label: t.label, type: t.type, title: t.title, artists: t.artists, episodes: t.episodes, video: t.video, youtube: "", spoiler: t.spoiler })),
    ...userThemes.map((t) => ({ key: `u${t.id}`, id: t.id, label: t.type === "IN" ? "Insert" : t.type, type: t.type, title: t.title, artists: "", episodes: "", video: "", youtube: youtubeId(t.url) ?? "", spoiler: false })),
  ];
  const isFav = m.fav_rank != null;
  // Colonne d'infos et tags : saisis à la main (« Modifier la fiche ») ou ceux des sources.
  const override = m.info_override ? (JSON.parse(m.info_override) as { rows: { label: string; value: string }[]; tags: { name: string; rank: number; spoiler: boolean }[] }) : null;
  const companyRows = [...new Set(info.companies.map((c) => c.role))]
    .sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b))
    .map((role) => ({ label: role, value: [...new Set(info.companies.filter((c) => c.role === role).map((c) => c.name))].join(", ") }));
  const sourceRows = [...info.facts, ...companyRows, ...(info.genres.length ? [{ label: "Genres", value: info.genres.join(", ") }] : [])];
  const shownTags = override ? override.tags : info.tags.slice(0, 30);
  // Bannière : celle choisie à la main, sinon celle des sources.
  const banner = m.banner || info.banner;
  // Bouton de statut : le suivi de sa fiche, ou de quoi ajouter celle d'un autre compte à sa bibliothèque.
  const entry = {
    id: m.id, kind: m.kind, title: m.title, subtitle: m.subtitle, year: m.year, cover: m.cover, status: m.status, progress: m.progress,
    total: m.total, rating: m.rating, started_on: m.started_on, notes: m.notes, liked: m.liked, private: m.private,
  };
  const mineHere = editable ? undefined : friends.find((f) => f.uid === me.id);
  const asResult = {
    kind: m.kind, title: m.title, subtitle: m.subtitle, year: m.year, cover: m.cover, total: m.total, format: m.format, author: m.author,
    anilist_id: m.anilist_id, tmdb_id: m.tmdb_id, tvmaze_id: m.tvmaze_id, steam_id: m.steam_id, letterboxd_slug: m.letterboxd_slug,
    backloggd_slug: m.backloggd_slug, mangadex_id: m.mangadex_id, isbn: m.isbn, source: "Almanach",
  };
  const otherTitles = [...info.synonyms];

  return (
    <div className="-mx-4 -mt-6 sm:-mx-6">
      {/* Bannière : image de la source, sinon la couverture floutée. */}
      <div className="relative h-40 overflow-hidden bg-neutral-900 sm:h-72">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={banner || m.cover}
          alt=""
          referrerPolicy="no-referrer"
          className={`size-full object-cover ${banner ? "" : "scale-110 opacity-50 blur-2xl"}`}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/40" />
      </div>

      <header className="bg-raised">
        <div className="mx-auto flex max-w-6xl gap-4 px-4 sm:gap-7 sm:px-6">
          <div className="relative -mt-16 w-28 shrink-0 space-y-3 pb-5 sm:-mt-36 sm:w-52">
            <div className="overflow-hidden rounded-md shadow-xl">
              {editable ? <CoverEditor mediaId={m.id} cover={m.cover} title={m.title} /> : <Cover src={m.cover} title={m.title} />}
            </div>
            {/* Statut ▾ et cœur (sa fiche), « Ajouter » ou son propre statut (fiche d'un autre compte). */}
            {editable ? (
              <StatusButton own={entry} banner={banner} />
            ) : mineHere ? (
              <StatusButton mine={{ id: mineHere.id, status: mineHere.status }} banner={banner} />
            ) : (
              <StatusButton add={asResult} banner={banner} />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2 py-4 sm:py-6">
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
              <span className="inline-block size-2 rounded-full" style={{ background: KIND_COLOR[m.kind] }} />
              {KIND_LABEL[m.kind]}
              {m.format && FORMAT_LABEL[m.format] && FORMAT_LABEL[m.format] !== KIND_LABEL[m.kind] ? ` · ${FORMAT_LABEL[m.format]}` : ""}
              {m.year ? ` · ${m.year}` : ""}
              {m.private ? <span className="rounded bg-fg/10 px-1.5 text-xs text-fg" title="Visible de toi seul">Privé</span> : null}
            </p>
            <h1 className="text-xl leading-tight font-bold tracking-tight sm:text-3xl">{m.title}</h1>
            {(m.author || m.subtitle) && <p className="text-muted">{m.author || m.subtitle}</p>}
            {editable && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span>
                {STATUS_LABEL[m.status]}
                {unit && (m.progress > 0 || m.total) ? ` · ${m.progress}${m.total ? ` / ${m.total}` : ""} ${unit}s` : ""}
              </span>
              {(m.status === "termine" || m.rating != null) && <RateButton value={m.rating} action={setRating.bind(null, m.id)} size={22} step="quarter" showValue />}
              {isFav && <span className="text-muted">{m.fav_rank === 1 ? "👑 Favori couronné" : `Favori n°${m.fav_rank}`}</span>}
            </div>
            )}
            {editable && (
              <p className="flex flex-wrap gap-2">
                {isFav ? (
                  <>
                    {m.fav_rank !== 1 && <ActionButton quiet action={setFavorite.bind(null, m.id, "crown")} className="text-xs">Couronner</ActionButton>}
                    <ActionButton quiet action={setFavorite.bind(null, m.id, "remove")} className="text-xs">Retirer des favoris</ActionButton>
                  </>
                ) : (
                  <ActionButton quiet action={setFavorite.bind(null, m.id, "add")} className="text-xs">Ajouter aux favoris</ActionButton>
                )}
              </p>
            )}
            {info.description && <div className="hidden pt-2 sm:block"><Clamp text={info.description} /></div>}
            <p className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-sm text-muted">
              {[...externalLinks(m), ...info.links].map(([label, href]) => (
                <a key={label} href={href} target="_blank" rel="noreferrer" className="link">{label}</a>
              ))}
            </p>
          </div>
        </div>
        {info.description && <div className="px-4 pb-5 sm:hidden"><Clamp text={info.description} /></div>}
      </header>

      <div className="mx-auto mt-8 grid max-w-6xl gap-10 px-4 sm:px-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        {/* Colonne d'infos, comme celle d'AniList. */}
        <aside className="order-2 space-y-6 md:order-1">
          {override ? (
            override.rows.length > 0 && (
              <dl className="space-y-3 rounded-md bg-raised p-4">
                {override.rows.map((f, i) => (
                  <div key={i}>
                    <dt className="text-sm font-medium">{f.label}</dt>
                    <dd className="text-sm whitespace-pre-line text-muted">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )
          ) : (info.facts.length > 0 || info.companies.length > 0 || info.genres.length > 0) && (
            <dl className="space-y-3 rounded-md bg-raised p-4">
              {info.facts.map((f) => (
                <div key={f.label}>
                  <dt className="text-sm font-medium">{f.label}</dt>
                  <dd className="text-sm text-muted">{f.value}</dd>
                </div>
              ))}
              <Companies list={info.companies} />
              {info.genres.length > 0 && (
                <div>
                  <dt className="text-sm font-medium">Genres</dt>
                  <dd className="text-sm text-muted">{info.genres.join(", ")}</dd>
                </div>
              )}
            </dl>
          )}

          <dl className="space-y-3 rounded-md bg-raised p-4">
            {info.titles.map((t) => (
              <div key={t.label}>
                <dt className="text-sm font-medium">{t.label}</dt>
                <dd className="text-sm break-words text-muted">{t.value}</dd>
              </div>
            ))}
            <div>
              <dt className="text-sm font-medium">Autres titres</dt>
              {otherTitles.map((s) => <dd key={s} className="text-sm break-words text-muted">{s}</dd>)}
              {userAliases.map((a) => (
                <dd key={a.title} className="flex items-baseline gap-2 text-sm break-words text-muted">
                  <span className="min-w-0 flex-1">{a.title}</span>
                  {editable && <ActionButton quiet action={removeAlias.bind(null, m.id, a.title)} className="text-[0.65rem]">×</ActionButton>}
                </dd>
              ))}
              {!otherTitles.length && !userAliases.length && <dd className="text-sm text-faint">Aucun</dd>}
              {editable && (
                <ActionForm action={addAlias.bind(null, m.id)} submit="Ajouter" resetOnSuccess className="mt-2 space-y-2 [&_button]:text-xs">
                  <input name="alias" placeholder="Alias (C;C, カオチャ…)" className="w-full text-sm" />
                </ActionForm>
              )}
            </div>
          </dl>

          {info.releases.length > 0 && (
            <div>
              <H2>Sorties</H2>
              <ul className="space-y-1.5 rounded-md bg-raised p-4 text-sm">
                {info.releases.map((r) => (
                  <li key={r.platform} className="flex justify-between gap-3">
                    <span className="min-w-0">{r.platform}</span>
                    <span className="shrink-0 text-muted tabular-nums">{r.date}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {info.timeToBeat && (
            <div>
              <H2>Temps pour finir</H2>
              <div className="grid grid-cols-3 gap-2 text-center">
                {(
                  [
                    ["Rapide", info.timeToBeat.hastily],
                    ["Normal", info.timeToBeat.normally],
                    ["À 100 %", info.timeToBeat.completely],
                  ] as const
                ).map(([label, h]) => (
                  <div key={label} className="rounded-md bg-raised px-1 py-2">
                    <p className="text-[0.7rem] text-muted">{label}</p>
                    <p className="font-semibold tabular-nums">{h ? `${h} h` : "–"}</p>
                  </div>
                ))}
              </div>
              {info.timeToBeat.count > 0 && (
                <p className="mt-1 text-xs text-faint">Selon {info.timeToBeat.count} joueur{info.timeToBeat.count > 1 ? "s" : ""} d’IGDB</p>
              )}
            </div>
          )}

          {shownTags.length > 0 && (
            <div>
              <H2>Tags</H2>
              <TagList tags={shownTags} />
            </div>
          )}
          {info.keywords.length > 0 && (
            <div>
              <H2>Mots-clés</H2>
              <p className="flex flex-wrap gap-1.5">
                {info.keywords.slice(0, 30).map((k) => (
                  <span key={k} className="rounded bg-raised px-2 py-1 text-xs text-muted">{k}</span>
                ))}
              </p>
            </div>
          )}
          {info.sources.length > 0 && <p className="text-xs text-faint">Infos : {info.sources.join(", ")}</p>}
        </aside>

        <div className="order-1 min-w-0 space-y-10 md:order-2">
          {editable && m.status !== "termine" && (unit || canRead) && (
            <section className="flex flex-wrap items-center gap-3">
              {unit && (m.kind === "roman" ? <PageField m={m} /> : <ActionButton action={stepProgress.bind(null, m.id, 1)}>+1 {unit}</ActionButton>)}
              {unit && m.progress > 0 && m.kind !== "roman" && <ActionButton quiet action={stepProgress.bind(null, m.id, -1)}>−1</ActionButton>}
              {canRead && m.mangadex_id && <Link href={`/lire/${m.id}`} className="btn-quiet">Lire ici</Link>}
            </section>
          )}

          {info.story && (
            <section>
              <H2>Histoire</H2>
              <Clamp text={info.story} />
            </section>
          )}

          {series && (
            <section>
              <H2>{series.title} · {series.done} / {series.total} {m.kind === "ln" ? "volumes" : "films"}</H2>
              <div className="flex flex-wrap gap-4">
                {seriesMembers.map((k) => (
                  <Link key={k.id} href={`/media/${k.id}`} className={`w-24 shrink-0 ${k.id === m.id ? "opacity-100" : "opacity-80 hover:opacity-100"}`}>
                    <Cover src={k.cover_grid || k.cover} title={k.title} className={k.id === m.id ? "ring-2 ring-accent" : ""} />
                    <p className="mt-1 line-clamp-2 text-xs">{k.title}</p>
                    {k.rating != null ? <Stars value={k.rating} size={12} /> : <p className="text-xs text-faint">{STATUS_LABEL[k.status]}</p>}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {(cards.length > 0 || moreGames.length > 0) && (
            <section>
              <H2>Relations</H2>
              <LimitedGrid>{cards.map((c) => <RelationCard key={c.key} c={c} />)}</LimitedGrid>
              {moreGames.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-muted">
                    Toute la série {seriesName} ({moreGames.length} autre{moreGames.length > 1 ? "s" : ""} jeu{moreGames.length > 1 ? "x" : ""})
                  </summary>
                  <div className="mt-3">
                    <SeriesGrid games={moreGames} own={ownGames} />
                  </div>
                </details>
              )}
            </section>
          )}

          {info.characters.length > 0 && (
            <section>
              <H2>
                {m.kind === "film" || m.kind === "serie" ? "Distribution" : "Personnages"}
                {info.charactersFrom && <span className="ml-2 font-normal tracking-normal normal-case">d’après {info.charactersFrom}</span>}
              </H2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {info.characters.map((c, i) => (
                  <div key={i} className="flex h-20 overflow-hidden rounded-md bg-raised text-xs">
                    {c.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-[60px] shrink-0 object-cover" />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col justify-between p-2">
                      <p className="line-clamp-2 font-medium">{c.name}</p>
                      <p className="text-faint">{c.role}</p>
                    </div>
                    {c.va && (
                      <>
                        <div className="flex min-w-0 flex-1 flex-col justify-between p-2 text-right">
                          <p className="line-clamp-2">{c.va.name}</p>
                          <p className="text-faint">{m.kind === "film" || m.kind === "serie" ? "" : "Japonais"}</p>
                        </div>
                        {c.va.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.va.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-[60px] shrink-0 object-cover" />
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {friends.length > 0 && (
            <section>
              <H2>Le groupe</H2>
              <ul className="divide-y divide-line overflow-hidden rounded-md bg-raised">
                {friends.map((f) => (
                  <li key={f.id}>
                    <Link href={`/u/${f.uid}`} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-fg/5">
                      {f.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.avatar} alt="" className="size-7 rounded-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent">{(f.pseudo || f.name).slice(0, 1).toUpperCase()}</span>
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">{f.pseudo || f.name}</span>
                      <span className="w-24 text-muted">{STATUS_LABEL[f.status]}</span>
                      <span className="flex w-28 items-center justify-end gap-1.5">
                        {f.review ? <span className="text-muted" title="Critique">≡</span> : null}
                        {f.liked ? <span className="text-like">♥</span> : null}
                        {f.rating != null && <Stars value={f.rating} size={12} />}
                      </span>
                    </Link>
                    {f.review && (
                      <details className="px-3 pb-2.5 pl-13 text-sm">
                        <summary className="cursor-pointer text-xs text-muted">Sa critique</summary>
                        <p className="mt-1 whitespace-pre-line text-muted">{f.review}</p>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(themes.length > 0 || (editable && (m.kind === "anime" || m.kind === "jeu" || m.kind === "serie"))) && (
            <section className="space-y-4">
              <H2>Openings et endings</H2>
              {themes.length > 0 ? <ThemeList themes={themes} editable={editable} /> : <p className="text-sm text-muted">Aucun pour l’instant.</p>}
              {editable && (
                <details>
                  <summary className="cursor-pointer text-sm text-muted">Ajouter un lien YouTube</summary>
                  <ActionForm action={addTheme.bind(null, m.id)} submit="Ajouter" resetOnSuccess className="mt-3 max-w-xl">
                    <div className="grid grid-cols-[6rem_1fr] gap-3">
                      <label>
                        <span>Type</span>
                        <select name="type" className="w-full">
                          <option value="OP">Opening</option>
                          <option value="ED">Ending</option>
                          <option value="IN">Insert</option>
                        </select>
                      </label>
                      <label>
                        <span>Titre</span>
                        <input name="title" placeholder="Titre de la chanson" className="w-full" />
                      </label>
                      <label className="col-span-2">
                        <span>Lien YouTube</span>
                        <input name="url" required placeholder="https://www.youtube.com/watch?v=…" className="w-full" />
                      </label>
                    </div>
                  </ActionForm>
                </details>
              )}
            </section>
          )}

          {editable && (
            <section className="space-y-3">
              <H2>Critique</H2>
              {editable ? (
                <ActionForm action={setReview.bind(null, m.id)} submit="Enregistrer la critique" className="max-w-2xl">
                  <textarea name="review" rows={m.review ? 8 : 3} defaultValue={m.review} placeholder="Ce que tu en as pensé…" className="w-full" />
                </ActionForm>
              ) : (
                <p className="max-w-2xl whitespace-pre-line">{m.review}</p>
              )}
            </section>
          )}

          {editable && (
            <section>
              {m.status === "termine" ? (
                <details>
                  <summary className="cursor-pointer text-sm text-muted">Revu / relu ? Ajouter une fin</summary>
                  <FinishForm m={m} />
                </details>
              ) : (
                <>
                  <H2>Terminer</H2>
                  <FinishForm m={m} />
                </>
              )}
            </section>
          )}

          {editable && (
            <section className="space-y-4">
              <H2>{m.kind === "manga" || m.kind === "ln" || m.kind === "roman" ? "Où lire" : m.kind === "jeu" ? "Liens" : "Où regarder"}</H2>
              {links.length > 0 && (
                <ul className="divide-y divide-line">
                  {links.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 py-2.5">
                      <Link href={`/voir/${l.id}`} className="min-w-0 flex-1 truncate font-medium">{l.label}</Link>
                      <a href={l.url} target="_blank" rel="noreferrer" className="link text-sm text-muted">Nouvel onglet</a>
                      <ActionButton quiet action={deleteLink.bind(null, l.id)} className="text-xs">Retirer</ActionButton>
                    </li>
                  ))}
                </ul>
              )}
              <ActionForm action={addLink.bind(null, m.id)} submit="Ajouter le lien" resetOnSuccess className="max-w-xl">
                <div className="grid grid-cols-[1fr_2fr] gap-3">
                  <label>
                    <span>Nom</span>
                    <input name="label" placeholder="Crunchyroll" className="w-full" />
                  </label>
                  <label>
                    <span>Adresse</span>
                    <input name="url" required placeholder="https://…" className="w-full" />
                  </label>
                </div>
              </ActionForm>
              {canRead &&
                (m.mangadex_id ? (
                  <p className="text-sm text-muted">
                    Lecteur relié à MangaDex. <Link href={`/lire/${m.id}`} className="link text-fg">Chapitres</Link>
                    {" · "}
                    <ActionButton quiet action={setMangadex.bind(null, m.id, null)} className="text-xs">Délier</ActionButton>
                  </p>
                ) : (
                  <MangadexLinker mediaId={m.id} title={m.title} />
                ))}
            </section>
          )}

          {editable && (
          <section className="space-y-3">
            <H2>Historique</H2>
            {logs.length ? (
              <ul className="divide-y divide-line">
                {logs.map((l) => (
                  <li key={l.id} className="space-y-2 py-3">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                      <span>
                        {l.rewatch ? "Revu" : "Terminé"}
                        {SOURCE_LABEL[l.source] ? ` · ${SOURCE_LABEL[l.source]}` : ""}
                        {editable && l.backloggd_pending ? " · à envoyer sur Backloggd" : ""}
                        {!editable && ` · ${l.finished_on ?? "date inconnue"}`}
                      </span>
                      {editable ? (
                        <RateButton value={l.rating} action={setLogRating.bind(null, l.id)} step="quarter" showValue />
                      ) : (
                        l.rating != null && <Stars value={l.rating} size={14} />
                      )}
                    </p>
                    {editable && (
                      <>
                        <div className="flex flex-wrap items-center gap-3">
                          <ActionForm action={setLogDate.bind(null, l.id)} submit="Changer" className="flex flex-wrap items-center gap-3 [&>div]:mt-0">
                            <DateFields value={l.finished_on} unknown={Boolean(l.unknown)} />
                          </ActionForm>
                          <ActionButton quiet action={deleteLog.bind(null, l.id)} confirm="Supprimer cette fin ?" className="text-xs">Supprimer</ActionButton>
                        </div>
                        {!l.finished_on && !l.unknown && <p className="text-sm text-danger">À dater : n’apparaît pas dans le calendrier.</p>}
                        {l.finished_on && l.finished_on.length < 10 && (
                          <p className="text-xs text-muted">Compte dans le récap de {l.finished_on.slice(0, 4)}, sans case dans le calendrier.</p>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Pas encore terminé.</p>
            )}
          </section>
          )}

          {editable && (
            <section>
              <details>
                <summary className="cursor-pointer text-sm font-semibold tracking-wide text-muted uppercase">Relations : relier à une autre œuvre</summary>
                <div className="mt-4">
                  <ParentPicker mediaId={m.id} override={m.parent_override} relation={m.parent_relation} current={parent ? { id: parent.id, title: parent.title } : null} />
                </div>
              </details>
            </section>
          )}

          {editable && (
            <section>
              <details>
                <summary className="cursor-pointer text-sm font-semibold tracking-wide text-muted uppercase">Modifier la fiche</summary>
                <div className="mt-4 mb-6 flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-muted">{m.private ? "Fiche privée : visible de toi seul." : "Fiche visible du groupe."}</span>
                  <ActionButton quiet action={setPrivate.bind(null, m.id, !m.private)} className="text-xs">
                    {m.private ? "Rendre visible" : "Rendre privée"}
                  </ActionButton>
                </div>
                <ActionForm action={updateMedia.bind(null, m.id)} submit="Enregistrer" className="max-w-xl">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="col-span-2"><span>Titre</span><input name="title" defaultValue={m.title} className="w-full" /></label>
                    <label className="col-span-2"><span>Autre titre</span><input name="subtitle" defaultValue={m.subtitle} className="w-full" /></label>
                    {m.kind === "roman" && (
                      <label className="col-span-2"><span>Auteur</span><input name="author" defaultValue={m.author} className="w-full" /></label>
                    )}
                    <label>
                      <span>Statut</span>
                      <select name="status" defaultValue={m.status} className="w-full">
                        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    </label>
                    <label><span>Année</span><input name="year" inputMode="numeric" defaultValue={m.year ?? ""} className="w-full" /></label>
                    <label><span>Progression</span><input name="progress" inputMode="numeric" defaultValue={m.progress} className="w-full" /></label>
                    <label><span>Total</span><input name="total" inputMode="numeric" defaultValue={m.total ?? ""} className="w-full" /></label>
                    <label><span>Note /10</span><input name="rating" inputMode="decimal" defaultValue={m.rating ?? ""} className="w-full" /></label>
                    <label><span>Commencé le</span><input type="date" name="started_on" defaultValue={m.started_on ?? ""} className="w-full" /></label>
                    <label className="col-span-2"><span>Couverture (adresse)</span><input name="cover" defaultValue={m.cover} className="w-full" /></label>
                    <label className="col-span-2"><span>Notes</span><textarea name="notes" rows={4} defaultValue={m.notes} className="w-full" /></label>
                  </div>
                </ActionForm>
                <div className="mt-10 max-w-xl">
                  <BannerEditor mediaId={m.id} banner={banner} custom={Boolean(m.banner)} />
                </div>
                <div className="mt-10 max-w-xl">
                  <InfoEditor
                    mediaId={m.id}
                    rows={override?.rows ?? sourceRows}
                    tags={override?.tags ?? info.tags.slice(0, 30)}
                    overridden={Boolean(override)}
                  />
                </div>
                <div className="mt-8">
                  <ActionButton quiet action={removeMedia.bind(null, m.id)} confirm={`Supprimer « ${m.title} » et son historique ?`}>
                    Supprimer de la bibliothèque
                  </ActionButton>
                </div>
              </details>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
