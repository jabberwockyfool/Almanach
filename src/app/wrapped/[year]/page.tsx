import { notFound } from "next/navigation";
import { connection } from "next/server";
import { wrapped } from "@/lib/stats";
import { requireUid } from "@/lib/user";
import { Slides } from "./slides";

export async function generateMetadata({ params }: PageProps<"/wrapped/[year]">) {
  return { title: `Récap ${(await params).year}` };
}

export default async function WrappedPage({ params }: PageProps<"/wrapped/[year]">) {
  await connection();
  const year = Number((await params).year);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) notFound();
  return <Slides data={await wrapped(await requireUid(), year)} />;
}
