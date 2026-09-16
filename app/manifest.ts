import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bounce — Brick Battle",
    short_name: "Bounce",
    description: "Same board. Your angle. A head-to-head brick-breaker arcade.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c1018",
    theme_color: "#0c1018",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/brand/bounce-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
