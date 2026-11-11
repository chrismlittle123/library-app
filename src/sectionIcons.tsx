import { useId } from "react";

// App-icon tiles for the library's top-level shelves: a rounded square with a
// lit-from-above gradient and a drawn glyph, in colours from the same warm palette.
interface Section {
  top: string;
  bottom: string;
  glyph: JSX.Element;
}

const SECTIONS: Record<string, Section> = {
  diary: {
    top: "#9a4636",
    bottom: "#5c1f17",
    glyph: (
      <>
        {/* A bound journal: spine, a label on the cover, and its ribbon hanging out. */}
        <path d="M13 9.5h13.5a2 2 0 0 1 2 2v17.5a2 2 0 0 1-2 2H13z" />
        <path d="M13 9.5a2 2 0 0 0-2 2v17.5a2 2 0 0 0 2 2" />
        <rect x="17.5" y="14" width="7.5" height="4.5" rx="1" />
        <path d="M22 31v4.5l1.7-1.4 1.7 1.4V31" />
      </>
    ),
  },
  catalogues: {
    top: "#d4974a",
    bottom: "#8f5a1e",
    glyph: (
      <>
        {/* Books standing on a shelf, the last one leaning. */}
        <rect x="10.5" y="12" width="5" height="17.5" rx="1" />
        <rect x="16.5" y="9.5" width="5" height="20" rx="1" />
        <path d="M10.5 16h5M16.5 13.5h5M10.5 25.5h5M16.5 25.5h5" opacity="0.7" />
        <path d="M23.5 14.2l4.6-1.4 4.4 15.2-4.6 1.4z" />
        <path d="M8.5 29.5h23" />
      </>
    ),
  },
  knowledge: {
    top: "#7f8d55",
    bottom: "#454f28",
    glyph: (
      <>
        {/* A lamp: the thing you know, lit. */}
        <path d="M16.2 25.5c-2.4-1.7-3.9-4.3-3.9-7.2a7.7 7.7 0 0 1 15.4 0c0 2.9-1.5 5.5-3.9 7.2v2.3h-7.6z" />
        <path d="M16.6 31h6.8" />
        <path d="M17.6 21.8l1.2-2.6 1.2 1.6 1.2-1.6 1.2 2.6" opacity="0.75" />
      </>
    ),
  },
  workshop: {
    top: "#5e7290",
    bottom: "#2d394d",
    glyph: (
      <>
        {/* A pencil laid across a ruler. */}
        <path d="M10 26.5l16.5-16.5 3.5 3.5L13.5 30H10z" />
        <path d="M23.5 13l3.5 3.5" />
        <path d="M10 33.5h20" opacity="0.7" />
        <path d="M14 33.5v-2M18 33.5v-1.4M22 33.5v-2M26 33.5v-1.4" opacity="0.7" />
      </>
    ),
  },
  inbox: {
    top: "#8b7b67",
    bottom: "#4e4336",
    glyph: (
      <>
        {/* A tray, with something just put in it. */}
        <path d="M9.5 22l3-10.5h15l3 10.5v7a2 2 0 0 1-2 2h-17a2 2 0 0 1-2-2z" />
        <path d="M9.5 22h6l1.5 3h6l1.5-3h6" />
        <path d="M16 16.5h8" opacity="0.7" />
      </>
    ),
  },
};

export function hasSectionIcon(name: string): boolean {
  return name in SECTIONS;
}

export function SectionIcon({ name, size = 40 }: { name: string; size?: number }) {
  const id = useId();
  const section = SECTIONS[name];
  if (!section) return null;
  return (
    <svg className="section-icon" viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={section.top} />
          <stop offset="1" stopColor={section.bottom} />
        </linearGradient>
        {/* The soft sheen across the top that makes it read as an icon, not a swatch. */}
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="9.5" fill={`url(#${id}-fill)`} />
      <rect width="40" height="40" rx="9.5" fill={`url(#${id}-sheen)`} />
      <rect x="0.5" y="0.5" width="39" height="39" rx="9" fill="none" stroke="#fff" strokeOpacity="0.12" />
      <g
        fill="none"
        stroke="#f6ead6"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: "drop-shadow(0 1px 0.6px rgba(0,0,0,0.35))" }}
      >
        {section.glyph}
      </g>
    </svg>
  );
}
