import Link from "next/link";
import { notFound } from "next/navigation";
import { after, connection } from "next/server";
import { KINDS, KIND_COLOR, KIND_PLURAL, isKind, type Kind } from "@/lib/kinds";
import { FACETS_OF, FACET_LABEL, MEASURE, groupBy, loadEntries, overview, warmStats, type Facet, type Group, type StatKind } from "@/lib/insights";
import { getUser, requireUser } from "@/lib/user";
import { withCovers } from "@/lib/prefs";
import { listUsers } from "@/lib/user";
import { ActionButton } from "@/components/action-button";
import { refreshStats } from "@/app/actions";
import { SettingActions } from "./setting-actions";

export const metadata = { title: "Stats" };

type Sort = "count" | "note" | "temps";
const isFacet = (v: unknown): v is Facet => typeof v === "string" && v in FACET_LABEL;

// Minutes → « 3 j 4 h », sinon chapitres ou pages.
function amount(n: number, kind: StatKind): string {
  const measure = MEASURE[kind];
  if (measure !== "minutes") return `${n.toLocaleString("fr-FR")} ${measure}`;
  if (n < 60) return `${Math.round(n)} min`;
  const hours = Math.round(n / 60);
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return d ? `${d} j${h ? ` ${h} h` : ""}` : `${h} h`;
}
const timeLabel = (kind: StatKind) => (MEASURE[kind] === "minutes" ? (kind === "jeu" ? "Temps de jeu" : "Temps passé") : MEASURE[kind] === "chapitres" ? "Chapitres lus" : "Pages lues");
const score = (r: number | null) => (r == null ? "–" : `${r.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}/10`);

function Bars({ data, color }: { data: { label: string; count: number }[]; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="rounded-md bg-raised p-4">
      <div className="flex h-40 items-end gap-3">
        {data.map((d) => (
          <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${d.label} : ${d.count}`}>
            <span className="text-xs text-muted tabular-nums">{d.count || ""}</span>
            <span className="w-full max-w-9 rounded-t-[4px]" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 3 : 0, background: color }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3 border-t border-line pt-2">
        {data.map((d) => (
          <span key={d.label} className="min-w-0 flex-1 truncate text-center text-xs text-muted">{d.label}</span>
        ))}
      </div>
    </div>
  );
}

function Distribution({ title, data, color }: { title: string; data: { label: string; count: number }[]; color: string }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (!total) return null;
  return (
    <div className="space-y-3 rounded-md bg-raised p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {data.slice(0, 6).map((d) => {
        const pct = Math.round((d.count / total) * 100);
        return (
          <div key={d.label} className="space-y-1" title={`${d.label} : ${d.count}`}>
            <p className="flex justify-between gap-2 text-sm">
              <span className="truncate">{d.label}</span>
              <span className="shrink-0 text-muted tabular-nums">{pct ? `${pct} %` : "< 1 %"}</span>
            </p>
            <span className="block h-1.5 rounded-full bg-fg/10">
              <span className="block h-full rounded-full" style={{ width: `${Math.max(pct, 1)}%`, background: color }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function GroupCard({ g, rank, kind, href, wide, actions }: { g: Group; rank: number; kind: StatKind; href?: string; wide: boolean; actions?: React.ReactNode }) {
  return (
    <div className="group/card overflow-hidden rounded-md bg-raised">
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        {/* Le nom sur deux lignes au besoin, plutôt que coupé. */}
        {href ? (
          <Link href={href} className="link line-clamp-2 min-w-0 flex-1 text-lg leading-snug font-semibold break-words" title={g.name}>{g.name}</Link>
        ) : (
          <h3 className="line-clamp-2 min-w-0 flex-1 text-lg leading-snug font-semibold break-words" title={g.name}>{g.name}</h3>
        )}
        <span className="flex shrink-0 items-center gap-2">
          {actions}
          <span className="flex size-6 items-center justify-center rounded-full bg-fg/10 text-xs font-semibold tabular-nums">{rank}</span>
        </span>
      </div>
      <div className={`flex gap-3 p-4 ${wide ? "" : "flex-col"}`}>
        {g.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={g.image} alt="" referrerPolicy="no-referrer" loading="lazy" className="aspect-[2/3] w-24 shrink-0 rounded object-cover" />
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dd className="font-semibold tabular-nums">{g.count}</dd>
              <dt className="text-xs text-muted">Titres</dt>
            </div>
            <div>
              <dd className="font-semibold tabular-nums">{score(g.mean)}</dd>
              <dt className="text-xs text-muted">Note moyenne</dt>
            </div>
            <div>
              <dd className="font-semibold tabular-nums">{g.amount ? amount(g.amount, kind) : "–"}</dd>
              <dt className="text-xs text-muted">{timeLabel(kind)}</dt>
            </div>
          </dl>
          <div className="flex gap-2 overflow-hidden">
            {g.covers.slice(0, g.image ? 4 : 5).map((c) => (
              <Link key={c.id} href={`/media/${c.id}`} title={c.title} className="w-14 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.cover} alt={c.title} referrerPolicy="no-referrer" loading="lazy" className="aspect-[2/3] w-full rounded object-cover" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Statistiques de sa bibliothèque (ou de celle d'un autre membre, ?u=), façon AniList.
export default async function Stats({ searchParams }: PageProps<"/stats">) {
  await connection();
  const me = await requireUser();
  const sp = await searchParams;
  const owner = sp.u ? await getUser(Number(sp.u)) : me;
  if (!owner || owner.status === "pending") notFound();
  const mine = owner.id === me.id;
  // « Tout » par défaut, comme la bibliothèque.
  const kind: StatKind = isKind(sp.type) ? sp.type : "tout";
  const facets = FACETS_OF[kind];
  const vue: Facet | "apercu" = isFacet(sp.vue) && facets.includes(sp.vue) ? sp.vue : "apercu";
  const tri: Sort = sp.tri === "note" || sp.tri === "temps" ? sp.tri : "count";
  const color = kind === "tout" ? "var(--accent)" : KIND_COLOR[kind];

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const next = { u: mine ? null : String(owner.id), type: kind === "tout" ? null : kind, vue: vue === "apercu" ? null : vue, tri: tri === "count" ? null : tri, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return `/stats${s ? `?${s}` : ""}`;
  };
  const libraryHref = (param: string, value: string) =>
    `/bibliotheque?${mine ? "" : `u=${owner.id}&`}${kind === "tout" ? "" : `type=${kind}&`}${param}=${encodeURIComponent(value)}`;

  const { entries: raw, missing, missingVoices } = await loadEntries(owner.id, kind, me.id, vue === "doubleurs");
  // Ce qui manque encore se récupère en arrière-plan, après l'envoi de la page.
  if (missing || missingVoices || kind === "anime") after(() => warmStats(owner.id, kind).catch(() => {}));
  const entries = await withCovers(raw.map((e) => ({ ...e, cover_grid: e.m.cover_grid }))).then((list) =>
    list.map((e) => ({ ...e, m: { ...e.m, cover_grid: e.cover_grid } })),
  );
  const chip = (on: boolean) => (on ? "font-semibold text-fg" : "text-muted hover:text-fg");
  // Les membres du groupe, pour voir leurs stats.
  const members = (await listUsers()).filter((u) => u.status !== "pending");
  const settingFacet = vue === "pays" || vue === "lieux" || vue === "epoques";
  const groups = vue === "apercu" ? [] : groupBy(entries, vue, tri);
  const ov = vue === "apercu" ? overview(entries) : null;

  return (
    <div className="space-y-6">
      {members.length > 1 && (
        <p className="flex flex-wrap gap-2">
          {members.map((u) => {
            const on = u.id === owner.id;
            return (
              <Link
                key={u.id}
                href={href({ u: u.id === me.id ? null : String(u.id) })}
                className={`inline-flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm ${on ? "bg-fg/10 font-medium text-fg" : "text-muted hover:bg-fg/5 hover:text-fg"}`}
              >
                {u.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.avatar} alt="" className="size-6 rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="flex size-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent">{u.name.slice(0, 1).toUpperCase()}</span>
                )}
                {u.id === me.id ? "Moi" : u.name}
              </Link>
            );
          })}
        </p>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xl font-bold tracking-tight">
          Stats{mine ? "" : ` de ${owner.name}`}
          <ActionButton quiet action={refreshStats.bind(null, owner.id, kind)} className="text-xs font-normal tracking-normal">
            Mettre à jour
          </ActionButton>
        </h1>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href={href({ type: null, vue: null })} className={chip(kind === "tout")}>Tout</Link>
          {KINDS.map((k) => (
            <Link key={k} href={href({ type: k, vue: null })} className={chip(kind === k)}>{KIND_PLURAL[k]}</Link>
          ))}
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-[10rem_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto text-sm md:flex-col">
          {(["apercu", ...facets] as const).map((v) => (
            <Link
              key={v}
              href={href({ vue: v === "apercu" ? null : v })}
              className={`shrink-0 rounded px-3 py-1.5 ${vue === v ? "bg-fg/10 font-medium text-fg" : "text-muted hover:text-fg"}`}
            >
              {v === "apercu" ? "Vue d’ensemble" : FACET_LABEL[v]}
            </Link>
          ))}
        </nav>

        <div className="min-w-0 space-y-8">
          {missing > 0 && (
            <p className="rounded-md bg-raised px-4 py-3 text-sm text-muted">
              Infos encore à récupérer pour {missing} œuvre{missing > 1 ? "s" : ""} (genres, studios, durées…). Elles arrivent en arrière-plan :
              recharge la page dans un moment.
            </p>
          )}

          {missingVoices > 0 && (
            <p className="rounded-md bg-raised px-4 py-3 text-sm text-muted">
              AniList ne donne les doubleurs qu’œuvre par œuvre : encore {missingVoices} à récupérer. Recharge l’onglet pour continuer
              (ouvrir une fiche les récupère aussi).
            </p>
          )}

          {ov && (
            <>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {(
                  [
                    [String(ov.total), kind === "tout" ? "Œuvres" : KIND_PLURAL[kind]],
                    [ov.amount ? amount(ov.amount, kind) : "–", timeLabel(kind)],
                    ...(kind === "anime" ? ([[ov.planned ? amount(ov.planned, kind) : "–", "Encore prévu"]] as const) : []),
                    [score(ov.mean), "Note moyenne"],
                    [ov.deviation == null ? "–" : ov.deviation.toLocaleString("fr-FR", { maximumFractionDigits: 1 }), "Écart type"],
                  ] as [string, string][]
                ).map(([value, label]) => (
                  <div key={label} className="rounded-md bg-raised p-4">
                    <dd className="text-2xl font-bold tabular-nums">{value}</dd>
                    <dt className="text-sm text-muted">{label}</dt>
                  </div>
                ))}
              </dl>
              <section>
                <h2 className="mb-3 text-lg font-semibold">Notes (en étoiles)</h2>
                <Bars data={ov.scores} color={color} />
              </section>
              {kind === "anime" && (
                <section>
                  <h2 className="mb-3 text-lg font-semibold">Nombre d’épisodes</h2>
                  <Bars data={ov.episodes} color={color} />
                </section>
              )}
              <section className="grid gap-4 md:grid-cols-3">
                {kind === "tout" ? (
                  <Distribution title="Types" data={ov.kinds} color={color} />
                ) : (
                  <Distribution title="Formats" data={ov.formats} color={color} />
                )}
                <Distribution title="Statuts" data={ov.statuses} color={color} />
                <Distribution title="Pays d’origine" data={ov.origins} color={color} />
              </section>
            </>
          )}

          {vue !== "apercu" && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{FACET_LABEL[vue]}</h2>
                <p className="inline-flex rounded-md border border-line p-0.5 text-sm">
                  {(
                    [
                      ["count", "Nombre"],
                      ["note", "Note moyenne"],
                      ["temps", timeLabel(kind)],
                    ] as const
                  ).map(([v, label]) => (
                    <Link key={v} href={href({ tri: v === "count" ? null : v })} className={`rounded px-3 py-1 ${tri === v ? "bg-fg/10 font-medium text-fg" : "text-muted hover:text-fg"}`}>
                      {label}
                    </Link>
                  ))}
                </p>
              </div>
              {groups.length ? (
                <div className={`grid gap-4 ${vue === "doubleurs" || vue === "staff" ? "lg:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
                  {groups.slice(0, 60).map((g, i) => (
                    <GroupCard
                      key={g.key}
                      g={g}
                      rank={i + 1}
                      kind={kind}
                      wide={vue === "doubleurs" || vue === "staff"}
                      href={settingFacet ? libraryHref(vue === "pays" ? "pays" : vue === "lieux" ? "lieu" : "epoque", g.name) : undefined}
                      actions={settingFacet && mine ? <SettingActions facet={vue} name={g.name} /> : undefined}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">
                  {settingFacet ? "Aucune fiche renseignée pour l’instant." : tri === "note" ? "Pas assez de titres notés (au moins 3 par groupe)." : "Rien à montrer."}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
