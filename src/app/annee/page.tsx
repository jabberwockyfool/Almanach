import { redirect } from "next/navigation";
import { connection } from "next/server";

export default async function CurrentYear() {
  await connection();
  redirect(`/annee/${new Date().getFullYear()}`);
}
