export function ExperimentalBadge() {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide"
      style={{
        border: "1px solid rgba(250,179,135,0.55)",
        backgroundColor: "rgba(250,179,135,0.12)",
        color: "#fab387",
      }}
      title="This hero configuration is experimental"
      aria-label="Experimental hero configuration"
      data-testid="experimental-hero-badge"
    >
      Experimental
    </span>
  );
}
