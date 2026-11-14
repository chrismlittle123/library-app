// Small illustrations, drawn as filled objects so their silhouettes survive at
// note-row size. The muted grounds share the library's ink-and-paper palette.
const SECTIONS = {
  Catalogues: {
    ground: "#30291e",
    art: <>
      <path d="M10 48h44" stroke="#bdaa84" strokeWidth="2" strokeLinecap="round" />
      <rect x="12" y="20" width="10" height="27" rx="2" fill="#cf9e58" />
      <path d="M15 23v21" stroke="#f0d8a6" strokeWidth="1.5" />
      <path d="M17 26h3m-3 15h3" stroke="#77522d" strokeWidth="1.5" />
      <rect x="24" y="14" width="12" height="33" rx="2" fill="#abb7a0" />
      <path d="M27 17v27" stroke="#d9dfcb" strokeWidth="1.5" />
      <path d="M30 21h3m-3 19h3" stroke="#64745e" strokeWidth="1.5" />
      <g transform="rotate(-14 46 46)"><rect x="40" y="21" width="10" height="26" rx="2" fill="#c17e6d" /><path d="M43 24v20m2-17h3m-3 13h3" stroke="#efc3a8" strokeWidth="1.5" /></g>
    </>,
  },
  Notes: {
    ground: "#30291e",
    art: <>
      <path d="M18 15h28v35H18z" fill="#e0d5bd" />
      <path d="M24 24h16m-16 6h16m-16 6h12m-12 6h15" stroke="#8e8066" strokeWidth="2" strokeLinecap="round" />
      <path d="m43 47 7-7 4 4-7 7-6 2z" fill="#c89156" />
    </>,
  },
  Diary: {
    ground: "#342329",
    art: <>
      <path d="M18 13h27a3 3 0 0 1 3 3v33H20a5 5 0 0 1-5-5V18a5 5 0 0 1 3-5" fill="#8c4b51" />
      <path d="M20 13v32" stroke="#d68e88" strokeWidth="2" />
      <path d="M20 44h27v7H20a3.5 3.5 0 0 1 0-7" fill="#e8d9b9" />
      <path d="M22 47h22" stroke="#b4a483" strokeWidth="1" />
      <path d="M36 45h6v12l-3-2-3 2z" fill="#c99550" />
      <rect x="27" y="22" width="14" height="10" rx="1" fill="none" stroke="#d5a59a" strokeWidth="1.2" />
      <path d="M31 27h6" stroke="#e2c5ac" strokeWidth="1.4" strokeLinecap="round" />
    </>,
  },
  Knowledge: {
    ground: "#262e27",
    art: <>
      <path d="m24 27-8 19h35l-8-19" fill="#e0b65c" opacity=".12" />
      <path d="M36 29v19m-9 3h19" stroke="#acb49a" strokeWidth="3" strokeLinecap="round" />
      <path d="m25 16-9 17h35L42 16z" fill="#94a18b" />
      <path d="m25 16-7 14h8l4-14z" fill="#bec8ab" />
      <path d="M15 33h37" stroke="#e5cf9b" strokeWidth="2" strokeLinecap="round" />
      <path d="M31 39h9" stroke="#e8c77e" strokeWidth="1.5" strokeLinecap="round" opacity=".7" />
      <path d="M22 52h29" stroke="#5b6b58" strokeWidth="2" strokeLinecap="round" />
    </>,
  },
  Workshop: {
    ground: "#242c35",
    art: <>
      <path d="M17 14h23l8 8v29H17z" fill="#bac7cc" />
      <path d="M40 14v9h8" fill="#8297a4" />
      <path d="M23 40h14m-14 5h9" stroke="#8297a4" strokeWidth="1.5" strokeLinecap="round" />
      <g transform="rotate(34 35 30)">
        <rect x="31" y="9" width="8" height="24" rx="3" fill="#c89156" />
        <path d="M31 16h8" stroke="#efd2a0" strokeWidth="2" />
        <path d="m31 33 4 13 4-13z" fill="#f0d9ab" />
        <path d="M35 34v9" stroke="#665444" strokeWidth="1" />
        <circle cx="35" cy="34" r="1.3" fill="#665444" />
      </g>
    </>,
  },
  Reflections: {
    ground: "#282b32",
    art: <>
      <path d="M29 39 24 55h16l-5-16" fill="#b48852" />
      <path d="M25 52h14" stroke="#e0c18a" strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="32" cy="25" rx="16" ry="20" fill="#c09a62" />
      <ellipse cx="32" cy="25" rx="12.5" ry="16" fill="#617775" />
      <path d="M25 20c2-4 6-6 10-6m-7 25c3 2 7 2 10 0" fill="none" stroke="#d7d3bd" strokeWidth="1.5" strokeLinecap="round" opacity=".8" />
    </>,
  },
  inbox: {
    ground: "#302b25",
    art: <>
      <path d="M21 16h25v27H21z" fill="#ddd2b6" transform="rotate(8 33 30)" />
      <path d="M25 24h14m-14 5h10" stroke="#a49b85" strokeWidth="1.5" strokeLinecap="round" />
      <path d="m13 32 4-10h6v10h24V22h3l4 10v18H13z" fill="#b18c65" />
      <path d="M13 33h13l3 6h9l3-6h13v17H13z" fill="#c5a581" />
      <path d="M29 44h10" stroke="#755d44" strokeWidth="2" strokeLinecap="round" />
    </>,
  },
};

type SectionName = keyof typeof SECTIONS;
export function hasSectionIcon(name: string): name is SectionName {
  return Object.prototype.hasOwnProperty.call(SECTIONS, name);
}

export function SectionIcon({ name, size = 48 }: { name: string; size?: number }) {
  if (!hasSectionIcon(name)) return null;
  const section = SECTIONS[name];
  return <svg className="section-icon" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
    <rect x="1" y="1" width="62" height="62" rx="17" fill={section.ground} />
    {section.art}
  </svg>;
}
