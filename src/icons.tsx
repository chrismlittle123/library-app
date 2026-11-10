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
