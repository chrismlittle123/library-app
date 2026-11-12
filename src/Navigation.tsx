export function HomeButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="tool home-button" aria-label="Home" title="Home" onClick={onClick}>
    Home
  </button>;
}
