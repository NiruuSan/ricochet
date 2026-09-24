import { useId } from "react";

/**
 * The Solana network's mark: three slanted bars, top to bottom, in the network's
 * own colours. It stands in for the word "SOL" wherever the balance is shown.
 */
export function SolanaMark({ size = 16, className = "" }: { size?: number; className?: string }) {
  // Several of these can share a page, so the gradient needs its own name.
  const fill = `solana-${useId()}`;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-label="Solana">
      <defs>
        <linearGradient id={fill} x1="2" y1="20" x2="22" y2="4" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9945ff" />
          <stop offset="1" stopColor="#14f195" />
        </linearGradient>
      </defs>
      {/* Each bar is a parallelogram; the top and bottom lean the same way, the middle the other. */}
      <path d="M6.2 4.6h15.1a.6.6 0 0 1 .43 1.02l-3.03 3.06a1.2 1.2 0 0 1-.85.36H2.75a.6.6 0 0 1-.43-1.02l3.03-3.06a1.2 1.2 0 0 1 .85-.36Z" fill={`url(#${fill})`} />
      <path d="M2.75 10.56h15.1c.32 0 .63.13.85.36l3.03 3.06a.6.6 0 0 1-.43 1.02H6.2a1.2 1.2 0 0 1-.85-.36l-3.03-3.06a.6.6 0 0 1 .43-1.02Z" fill={`url(#${fill})`} />
      <path d="M6.2 16.52h15.1a.6.6 0 0 1 .43 1.02l-3.03 3.06a1.2 1.2 0 0 1-.85.36H2.75a.6.6 0 0 1-.43-1.02l3.03-3.06a1.2 1.2 0 0 1 .85-.36Z" fill={`url(#${fill})`} />
    </svg>
  );
}
