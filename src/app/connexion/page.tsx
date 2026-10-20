export const metadata = { title: "Connexion" };

// Connexion par Discord (réservée aux comptes approuvés : un nouveau compte attend l'accord d'un admin).
export default async function Login({ searchParams }: PageProps<"/connexion">) {
  const sp = await searchParams;
  const suite = typeof sp.suite === "string" && sp.suite.startsWith("/") ? sp.suite : "/";
  const erreur = typeof sp.erreur === "string" ? sp.erreur : "";
  return (
    <div className="mx-auto mt-24 flex max-w-xs flex-col gap-5">
      <h1 className="text-3xl font-bold tracking-tight">Almanach</h1>
      <p className="text-muted">Films, séries, jeux, anime, manga, light novels et romans : ton année en médias.</p>
      <a
        href={`/api/auth/discord?suite=${encodeURIComponent(suite)}`}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-[#5865f2] px-5 py-2.5 font-semibold text-white hover:bg-[#4752c4]"
      >
        <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden>
          <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9 -.3 13.5.1 17.9a19.9 19.9 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.8 19.8 0 0 0 6-3c.5-5.1-.8-9.6-3.6-13.5ZM8.5 15.2c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Zm7 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z" />
        </svg>
        Se connecter avec Discord
      </a>
      {erreur && <p className="text-sm text-danger">{erreur}</p>}
    </div>
  );
}
