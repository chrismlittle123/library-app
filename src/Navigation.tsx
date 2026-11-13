export function HomeButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="tool home-button" aria-label="Home" title="Home" onClick={onClick}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.8 10.6 12 4l8.2 6.6" />
      <path d="M5.8 9.5v10.1h12.4V9.5M9.5 19.6v-6.1h5v6.1" />
    </svg>
  </button>;
}
