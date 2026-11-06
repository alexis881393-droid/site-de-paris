import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // PGlite (dev local uniquement) et ws ne doivent pas être bundlés.
  serverExternalPackages: ["@electric-sql/pglite", "ws"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          // Pas de X-Frame-Options ni de frame-ancestors : le site doit pouvoir s'ouvrir
          // partout, y compris intégré (iframe / NUI / DUI d'un script FiveM).
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
