import { useId } from 'react'

// Builds the wavy-edged "seal" outline (rosette shape) once, at module load.
function buildSealPath(
  lobes = 8,
  cx = 12,
  cy = 12,
  base = 9.8,
  amp = 1.3,
  steps = 120,
): string {
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const r = base + amp * Math.cos(lobes * t)
    pts.push(`${(cx + r * Math.cos(t)).toFixed(2)} ${(cy + r * Math.sin(t)).toFixed(2)}`)
  }
  return 'M' + pts.join(' L') + ' Z'
}

const SEAL_PATH = buildSealPath()

// A scalloped green verification seal shown next to a verified vendor's name.
export default function VerifiedBadge({ size = 16 }: { size?: number }) {
  // unique gradient ids so many badges on one page don't clash
  const uid = useId().replace(/:/g, '')

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Verified vendor"
      style={{
        marginLeft: 5,
        verticalAlign: 'middle',
        flexShrink: 0,
        display: 'inline-block',
        filter: 'drop-shadow(0 1px 1.5px rgba(5,150,105,0.45))',
      }}
    >
      <title>Verified vendor</title>
      <defs>
        <linearGradient id={`body-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="55%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#047857" />
        </linearGradient>
        <linearGradient id={`shine-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* seal body */}
      <path d={SEAL_PATH} fill={`url(#body-${uid})`} />
      {/* soft highlight on the top half */}
      <path d={SEAL_PATH} fill={`url(#shine-${uid})`} />
      {/* thin inner ring */}
      <circle cx="12" cy="12" r="7.7" fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="0.6" />
      {/* check mark */}
      <path
        d="M7.6 12.4l3 3L16.4 9.2"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}