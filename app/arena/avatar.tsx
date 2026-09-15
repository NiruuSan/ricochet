import { Gem } from "lucide-react";
import { initials } from "./format";

/** A player's picture, or their initials when they have not uploaded one. */
export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- tiny, immutable images served by our own API
    return <img className="avatar avatar-img" src={src} alt="" width={size} height={size} style={style} />;
  }
  return (
    <span className="avatar" style={style} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function GemIcon({ size = 15 }: { size?: number }) {
  return <Gem size={size} className="gem-icon" aria-hidden />;
}
