import { AddSearch } from "./search";

export const metadata = { title: "Ajouter" };

export default function Add() {
  return <AddSearch hasTmdb={Boolean(process.env.TMDB_TOKEN)} />;
}
