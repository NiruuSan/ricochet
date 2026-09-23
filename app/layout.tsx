import type { Metadata, Viewport } from "next";
import { Cinzel, Fredoka, Orbitron, Press_Start_2P, VT323 } from "next/font/google";
import "./globals.css";
import { ActionDialogProvider } from "@/components/ui/action-dialog";

// The typefaces the themes wear (lib/themes.ts). Next downloads them at build
// time and serves them from this origin, so no theme costs the player a request
// to somebody else's server. Only the theme in use pulls its font: the rules
// below name the variables, and a font with no rule matching is never fetched.
const orbitron = Orbitron({ subsets: ["latin"], variable: "--font-orbitron", display: "swap", preload: false });
const pixel = Press_Start_2P({ subsets: ["latin"], weight: "400", variable: "--font-pixel", display: "swap", preload: false });
const cinzel = Cinzel({ subsets: ["latin"], variable: "--font-serif", display: "swap", preload: false });
const mono = VT323({ subsets: ["latin"], weight: "400", variable: "--font-mono", display: "swap", preload: false });
const round = Fredoka({ subsets: ["latin"], variable: "--font-round", display: "swap", preload: false });
const fonts = [orbitron, pixel, cinzel, mono, round].map((f) => f.variable).join(" ");

const title = "Bounce — Brick Battle";
const description = "Same board. Your angle. A head-to-head brick-breaker arcade. Play free or compete for devnet SOL and gems.";

export const metadata: Metadata = {
  title,
  description,
  applicationName: "Bounce",
  openGraph: { title, description, siteName: "Bounce", type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  themeColor: "#0c1018",
  // The phone tab bar and the page gutters pad themselves against the notch and
  // the home indicator (env(safe-area-inset-*)), so the page can use the whole screen.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fonts}>
      <body><ActionDialogProvider>{children}</ActionDialogProvider></body>
    </html>
  );
}
