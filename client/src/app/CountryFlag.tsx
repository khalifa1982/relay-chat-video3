import "flag-icons/css/flag-icons.min.css";

/**
 * Real SVG country flag, self-hosted via the bundled `flag-icons` set (no
 * third-party CDN — keeps with RELAY's self-hosted ethos). This replaces the
 * regional-indicator flag EMOJI, which renders correctly on iOS/Android/macOS
 * but shows as bare letters ("AE") on Windows and some Linux desktops — so the
 * flag "wasn't showing" for desktop users. `code` is an ISO-3166-1 alpha-2
 * country code (e.g. "AE", "US"); anything else renders nothing.
 */
export function CountryFlag({
  code,
  title,
  className = "",
}: {
  code?: string | null;
  title?: string;
  className?: string;
}) {
  const cc = (code || "").trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(cc)) return null;
  return (
    <span
      className={`fi fi-${cc} ${className}`}
      title={title ?? undefined}
      role="img"
      aria-label={title || `${cc.toUpperCase()} flag`}
      style={{
        // Compact, crisp, aspect-correct chip; `.fi` supplies the SVG background.
        width: "1.35em",
        height: "1em",
        borderRadius: "2px",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.18)",
        verticalAlign: "middle",
      }}
    />
  );
}
