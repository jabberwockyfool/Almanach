import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { KINDS, KIND_COLOR, KIND_LABEL, KIND_PLURAL, MONTHS, isKind, type Kind } from "@/lib/kinds";
import { finishesOf, undatedCount, type Finish } from "@/lib/stats";
import { requireUid } from "@/lib/user";
import { FinishList, type FinishGroup } from "@/components/finish-list";

export async function generateMetadata({ params }: PageProps<"/annee/[year]">) {
  return { title: `Année ${(await params).year}` };
}

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Un mois en grille lundi → dimanche. Chaque jour avec une fin montre la couverture (la dernière du jour).
function Month({ year, month, byDay, count }: { year: number; month: number; byDay: Map<string, Finish[]>; count: number }) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return (
    <section>
      <h2 className="mb-2 flex items-baseline justify-between text-sm">
        <a href={`#mois-${month + 1}`} className="font-semibold capitalize">{MONTHS[month]}</a>
        <span className="text-muted">{count || ""}</span>
      </h2>
      <div className="grid grid-cols-7 gap-1 text-center text-[0.65rem] text-faint">
        {WEEKDAYS.map((d, i) => <span key={i}>{d}</span>)}
        {Array.from({ length: offset }, (_, i) => <span key={`e${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const day = `${year}-${pad(month + 1)}-${pad(i + 1)}`;
          const list = byDay.get(day);
          if (!list) {
            return (
              <span key={day} className="flex aspect-[2/3] items-center justify-center rounded-sm bg-raised">
                {i + 1}
              </span>
            );
          }
          const last = list[list.length - 1];
          return (
            <Link
              key={day}
              href={list.length === 1 ? `/media/${last.id}` : `#jour-${day}`}
              title={list.map((f) => f.title).join("\n")}
              className="relative block aspect-[2/3] overflow-hidden rounded-sm"
            >
              {last.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={last.cover} alt={last.title} loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center bg-accent/25 p-0.5 text-[0.5rem] leading-tight text-fg">{last.title}</span>
              )}
              {list.length > 1 && (
                <span className="absolute right-0 bottom-0 rounded-tl-sm bg-bg/85 px-1 text-[0.6rem] font-bold text-fg">{list.length}</span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default async function YearPage({ params, searchParams }: PageProps<"/annee/[year]">) {
  await connection();
  const uid = await requireUid();
  const year = Number((await params).year);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) notFound();
  const sp = await searchParams;
  const type: Kind | null = isKind(sp.type) ? sp.type : null;
  const list = await finishesOf(uid, year, type);
  const all = type ? await finishesOf(uid, year) : list;
  const undated = await undatedCount(uid);

  const byDay = new Map<string, Finish[]>();
  // Le calendrier ne montre que les fins au jour près ; celles au mois près comptent dans leur mois.
  for (const f of list) if (f.finished_on.length === 10) byDay.set(f.finished_on, [...(byDay.get(f.finished_on) ?? []), f]);
  const monthCount = (m: number) => list.filter((f) => f.finished_on.slice(5, 7) === pad(m + 1)).length;
  const toRow = (f: Finish) => ({ ...f, rating: f.log_rating ?? f.rating });
  const groups: FinishGroup[] = MONTHS.map((name, m) => ({
    key: `mois-${m + 1}`,
    label: name,
    items: list.filter((f) => f.finished_on.slice(5, 7) === pad(m + 1)).map(toRow),
  }));
  const yearOnly = list.filter((f) => f.finished_on.length === 4);
  if (yearOnly.length) groups.push({ key: "annee-seule", label: `${year}, mois inconnu`, items: yearOnly.map(toRow) });
  const counts = KINDS.map((k) => [k, all.filter((f) => f.kind === k).length] as const).filter(([, n]) => n > 0);
  const chip = (on: boolean) => (on ? "font-semibold text-fg" : "text-muted hover:text-fg");
  const q = (k: Kind | null) => (k ? `?type=${k}` : "");

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="flex items-baseline gap-4 text-3xl font-bold tracking-tight">
            <Link href={`/annee/${year - 1}${q(type)}`} className="text-lg text-faint hover:text-fg" aria-label="Année précédente">←</Link>
            {year}
            <Link href={`/annee/${year + 1}${q(type)}`} className="text-lg text-faint hover:text-fg" aria-label="Année suivante">→</Link>
          </h1>
          <Link href={`/wrapped/${year}`} className="btn">Récap {year}</Link>
        </div>
        <p className="text-muted">
          {all.length} terminé{all.length > 1 ? "s" : ""}
          {counts.map(([k, n]) => ` · ${n} ${(n > 1 ? KIND_PLURAL[k] : KIND_LABEL[k]).toLowerCase()}`).join("")}
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href={`/annee/${year}`} className={chip(!type)}>Tout</Link>
          {KINDS.map((k) => (
            <Link key={k} href={`/annee/${year}?type=${k}`} className={`inline-flex items-center gap-1.5 ${chip(type === k)}`}>
              <span className="inline-block size-1.5 rounded-full" style={{ background: KIND_COLOR[k] }} />
              {KIND_PLURAL[k]}
            </Link>
          ))}
        </p>
        {undated > 0 && (
          <p className="text-sm text-danger">
            {undated} fin{undated > 1 ? "s" : ""} sans date (souvent des imports AniList sans date de fin) : elles n’apparaissent pas ici.{" "}
            <Link href="/sans-date" className="link">Les dater</Link>
          </p>
        )}
      </section>

      <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 12 }, (_, m) => <Month key={m} year={year} month={m} byDay={byDay} count={monthCount(m)} />)}
      </div>

      {yearOnly.length > 0 && (
        <p className="text-sm text-muted">
          {yearOnly.length} fin{yearOnly.length > 1 ? "s" : ""} datée{yearOnly.length > 1 ? "s" : ""} à l’année seulement :{" "}
          <a href="#annee-seule" className="link">en bas de la liste</a>.
        </p>
      )}

      {list.length > 0 && <FinishList groups={groups.filter((g) => g.items.length)} />}
    </div>
  );
}
