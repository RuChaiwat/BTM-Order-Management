const PALETTE = ['#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D']

/** First + last word's initial of an English name, e.g. "Chaiwat Ruangkhajit" -> "CR" -- same
 * pattern as Outlook/Teams' generated avatars. A single-word name falls back to its first two
 * letters. */
function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function colorForSeed(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

/** No photo-upload field exists (and deliberately so -- see AddUserModal/UserModal), so every
 * avatar in the app is this generated initials circle, keyed by a stable `seed` (a user/picker ID,
 * not the name, so the color doesn't shift if someone's name gets corrected later). */
export function Avatar({ name, seed, size = 48 }: { name: string; seed?: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: colorForSeed(seed ?? name),
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: Math.round(size * 0.4),
        flex: 'none',
      }}
    >
      {initialsFromName(name)}
    </div>
  )
}
