import type { Metadata, Viewport } from "next";
import "./globals.css";

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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
