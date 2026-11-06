import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, Chakra_Petch } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const chakra = Chakra_Petch({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-chakra", display: "swap" });
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow", display: "swap" });
const barlowCond = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-barlow-cond", display: "swap" });

export const metadata: Metadata = {
  title: "RACEBET CONTROL",
  description: "Comptabilité des paris fictifs (dollars FiveM) sur les courses RP. Aucun argent réel.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#070707",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${chakra.variable} ${barlow.variable} ${barlowCond.variable}`}>
      <body>
        <div className="relative z-10">{children}</div>
        <Toaster
          theme="dark"
          position="bottom-right"
          offset={{ bottom: "max(16px, env(safe-area-inset-bottom))", right: "max(16px, env(safe-area-inset-right))" }}
          toastOptions={{
            classNames: {
              toast: "!bg-plate !border !border-line-strong !text-ink !font-sans !rounded-none chamfer-sm",
              description: "!text-mute",
              success: "!border-l-4 !border-l-go",
              error: "!border-l-4 !border-l-stop",
            },
          }}
        />
      </body>
    </html>
  );
}
