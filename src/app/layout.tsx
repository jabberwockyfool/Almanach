import type { Metadata, Viewport } from "next";
import { Urbanist } from "next/font/google";
import { Nav } from "@/components/nav";
import { Main } from "@/components/main";
import { currentUser } from "@/lib/user";
import { getSetting } from "@/lib/db";
import "./globals.css";

const urbanist = Urbanist({ variable: "--font-urbanist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Almanach", template: "%s · Almanach" },
  description: "Films, séries, jeux, anime, manga, light novels et romans : suivi et récap de l'année.",
  appleWebApp: { capable: true, title: "Almanach", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#111214",
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser().catch(() => null);
  const pseudo = user ? (await getSetting(user.id, "pseudo").catch(() => "")) || user.name : "";
  return (
    <html lang="fr" className={urbanist.variable}>
      <body className="min-h-dvh font-sans antialiased">
        <Nav user={user && user.status !== "pending" ? { id: user.id, name: pseudo, avatar: user.avatar } : null} />
        <Main>{children}</Main>
      </body>
    </html>
  );
}
