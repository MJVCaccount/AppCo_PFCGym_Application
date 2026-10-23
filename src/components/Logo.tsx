import Image from "next/image";

/**
 * The PFC Gym mark, from the artwork the client supplied.
 *
 * Two crops of one artwork:
 *  - "wordmark" is the lettering only, for the header bar where the full
 *    hexagon would have to shrink past legibility to fit.
 *  - "full" includes the hexagon, for the places with vertical room: the
 *    footer, the auth cards and the promo hand-off.
 *
 * The source is 474px wide, so the largest render on the site still sits
 * above 3x device density. It is decorative wherever a visible "PFC" label
 * sits beside it, and labelled otherwise — the `alt` prop decides, and the
 * default is the brand name so a bare logo link is never unlabelled.
 */

type Variant = "full" | "wordmark";

// Intrinsic sizes, used to derive the rendered height. They must match the
// files exactly or next/image reserves the wrong box and the mark squashes.
const SOURCES: Record<Variant, { src: string; w: number; h: number }> = {
    full: { src: "/images/pfc-logo.png", w: 474, h: 414 },
    wordmark: { src: "/images/pfc-wordmark.png", w: 474, h: 118 },
};

interface Props {
    variant?: Variant;
    /** Rendered width in CSS pixels. Height follows the artwork's ratio. */
    width?: number;
    /** Empty string marks it decorative — only when nearby text already says "PFC". */
    alt?: string;
    className?: string;
    priority?: boolean;
}

export default function Logo({
    variant = "wordmark",
    width = 104,
    alt = "PFC Gym — Fighting and Fitness",
    className,
    priority = false,
}: Props) {
    const source = SOURCES[variant];
    const height = Math.round((source.h / source.w) * width);

    return (
        <Image
            className={className}
            src={source.src}
            alt={alt}
            width={width}
            height={height}
            priority={priority}
            style={{ width, height: "auto" }}
        />
    );
}