import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ricochet — Brick Battle",
  description: "Same board. Your angle. A head-to-head brick-breaker arcade. Play free or try demo-SOL matches.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
