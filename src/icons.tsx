// Drawn rather than typed, so they're the same weight and size on every phone.
const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const BackIcon = () => (
  <Icon>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M4.5 7h15M10 7V4.8h4V7M6.5 7l.9 12.2h9.2L17.5 7M10.2 10.5v5.5M13.8 10.5v5.5" />
  </Icon>
);

export const SettingsIcon = () => (
  <Icon>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);

export const BookIcon = () => (
  <svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M32 17c-5-4-13-5-21-4v32c8-1 16 0 21 4zM32 17c5-4 13-5 21-4v32c-8-1-16 0-21 4z" />
    <path d="M17 23c4 0 7 1 10 2M17 30c4 0 7 1 10 2M37 25c3-1 6-2 10-2M37 32c3-1 6-2 10-2" strokeLinecap="round" opacity="0.6" />
  </svg>
);

// The writing toolbar.
export const HeadingIcon = () => (
  <Icon>
    <path d="M6 5v14M16 5v14M6 12h10" />
  </Icon>
);

export const BoldIcon = () => (
  <Icon>
    <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
  </Icon>
);

export const ItalicIcon = () => (
  <Icon>
    <path d="M11 5h6M7 19h6M14 5l-4 14" />
  </Icon>
);

export const ListIcon = () => (
  <Icon>
    <path d="M10 7h10M10 12h10M10 17h10" />
    <circle cx="5" cy="7" r="0.8" fill="currentColor" />
    <circle cx="5" cy="12" r="0.8" fill="currentColor" />
    <circle cx="5" cy="17" r="0.8" fill="currentColor" />
  </Icon>
);

export const CheckboxIcon = () => (
  <Icon>
    <rect x="4.5" y="4.5" width="15" height="15" rx="3" />
    <path d="M8.5 12.2l2.4 2.3 4.6-5" />
  </Icon>
);

export const LinkIcon = () => (
  <Icon>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
);

export const UndoIcon = () => (
  <Icon>
    <path d="M9 7L5 11l4 4" />
    <path d="M5 11h9a5 5 0 0 1 0 10h-2" />
  </Icon>
);

export const RedoIcon = () => (
  <Icon>
    <path d="M15 7l4 4-4 4" />
    <path d="M19 11h-9a5 5 0 0 0 0 10h2" />
  </Icon>
);

export const HideKeyboardIcon = () => (
  <Icon>
    <rect x="3.5" y="4" width="17" height="10" rx="2" />
    <path d="M7 7.5h0M10.5 7.5h0M14 7.5h0M17 7.5h0M8.5 11h7M9 18l3 2.5 3-2.5" />
  </Icon>
);
