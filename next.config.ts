import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Module natif : chargé tel quel côté serveur, pas regroupé par Turbopack.
  serverExternalPackages: ["@libsql/client", "libsql"],
  images: { unoptimized: true },
};

export default nextConfig;
