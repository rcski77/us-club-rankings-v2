import { archivo, ibmPlexMono } from "@/lib/fonts";
import { brand } from "@/lib/brand";

/** Inline (not <img src="...svg">) so the wordmark actually renders in the loaded
 * Archivo/IBM Plex Mono webfonts -- an externally-referenced <img> SVG is rendered in
 * its own sandboxed document and can't see fonts loaded by the host page, so it would
 * silently fall back to the browser default sans-serif instead. */
export function LogoHorizontal({
  variant = "onLight",
  width = 170,
  className,
}: {
  variant?: "onLight" | "onDark";
  width?: number;
  className?: string;
}) {
  const onDark = variant === "onDark";
  const height = (width * 56) / 340;
  return (
    <svg
      viewBox="0 0 340 56"
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label="US Club Rankings 2.0"
    >
      <rect x="3.83" y="36.63" width="38.33" height="8.63" rx="1.44" fill={onDark ? "#FFFFFF" : brand.purple} />
      <rect x="3.83" y="25.13" width="27.79" height="8.63" rx="1.44" fill={brand.teal} />
      <rect x="3.83" y="13.63" width="17.25" height="8.63" rx="1.44" fill={brand.yellow} />
      <text
        x="62"
        y="27"
        className={archivo.className}
        fontSize="22"
        fontWeight="800"
        letterSpacing="-0.33"
        fill={onDark ? "#FFFFFF" : brand.ink}
      >
        US Club Rankings <tspan fill={brand.teal}>2.0</tspan>
      </text>
      <text
        x="62"
        y="45"
        className={ibmPlexMono.className}
        fontSize="10"
        fontWeight="500"
        letterSpacing="2"
        fill={onDark ? "rgba(255,255,255,0.65)" : brand.gray}
      >
        VOLLEYBALL
      </text>
    </svg>
  );
}

export function LogoStacked({ width = 220 }: { width?: number }) {
  const height = (width * 108) / 220;
  return (
    <svg viewBox="0 0 220 108" width={width} height={height} role="img" aria-label="US Club Rankings 2.0">
      <rect x="3.67" y="30.25" width="36.67" height="8.25" rx="1.38" fill={brand.purple} />
      <rect x="3.67" y="19.25" width="26.58" height="8.25" rx="1.38" fill={brand.teal} />
      <rect x="3.67" y="8.25" width="16.5" height="8.25" rx="1.38" fill={brand.yellow} />
      <text x="0" y="76" className={archivo.className} fontSize="19" fontWeight="800" letterSpacing="-0.28" fill={brand.ink}>
        US Club Rankings <tspan fill={brand.teal}>2.0</tspan>
      </text>
      <text x="0" y="98" className={ibmPlexMono.className} fontSize="10" fontWeight="500" letterSpacing="2" fill={brand.gray}>
        VOLLEYBALL
      </text>
    </svg>
  );
}

export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} role="img" aria-label="US Club Rankings">
      <rect x="4" y="33" width="40" height="9" rx="1.5" fill={brand.purple} />
      <rect x="4" y="21" width="29" height="9" rx="1.5" fill={brand.teal} />
      <rect x="4" y="9" width="18" height="9" rx="1.5" fill={brand.yellow} />
    </svg>
  );
}
