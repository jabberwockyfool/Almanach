"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavUser = { id: number; name: string; avatar: string } | null;

// En haut sur grand écran (avec l'avatar du compte vers son profil), onglets en bas sur téléphone.
// Masquée hors connexion, dans la visionneuse, le lecteur et le récap plein écran.
export function Nav({ user }: { user: NavUser }) {
  const path = usePathname();
  if (!user || path === "/connexion" || path === "/en-attente") return null;
  if (path.startsWith("/voir/") || path.startsWith("/wrapped/") || /^\/lire\/\d+\/./.test(path)) return null;
  const items = [
    { href: "/", label: "Accueil" },
    { href: "/bibliotheque", label: "Bibliothèque" },
    { href: "/annee", label: "Année" },
    { href: "/stats", label: "Stats" },
    { href: "/ajouter", label: "Ajouter" },
  ];
  const profile = `/u/${user.id}`;
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      <header className="hidden border-b border-line sm:block">
        <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4 text-sm">
          <Link href="/" className="mr-4 text-base font-bold tracking-tight">
            Almanach
          </Link>
          {items.slice(1).map((i) => (
            <Link key={i.href} href={i.href} className={active(i.href) ? "font-semibold text-fg" : "text-muted hover:text-fg"}>
              {i.label}
            </Link>
          ))}
          <Link href="/reglages" className={active("/reglages") ? "font-semibold text-fg" : "text-muted hover:text-fg"}>
            Réglages
          </Link>
          <Link href={profile} className="ml-auto flex items-center gap-2 text-muted hover:text-fg" title="Mon profil">
            {user.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar} alt="" className="size-7 rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent">{user.name.slice(0, 1).toUpperCase()}</span>
            )}
            <span className={active(profile) ? "font-semibold text-fg" : ""}>{user.name}</span>
          </Link>
        </nav>
      </header>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 backdrop-blur sm:hidden">
        <div className="grid grid-cols-5 text-center text-[0.72rem]">
          {[...items.filter((i) => i.href !== "/stats"), { href: profile, label: "Profil" }].map((i) => (
            <Link key={i.href} href={i.href} className={`py-3.5 ${active(i.href) ? "font-bold text-accent" : "text-muted"}`}>
              {i.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
