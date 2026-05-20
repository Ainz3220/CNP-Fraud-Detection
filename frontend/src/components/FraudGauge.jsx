import React from 'react'

/**
 * SVG arc gauge showing fraud probability 0–100%.
 * Green < 40%, amber 40–69%, red >= 70%.
 */
export default function FraudGauge({ probability = 0, size = 140 }) {
  const pct = Math.max(0, Math.min(1, probability))
  const radius = 46
  const cx = size / 2
  const cy = size / 2 + 10
  const startAngle = -210
  const totalArc = 240 // degrees

  const toRad = deg => (deg * Math.PI) / 180
  const polarToCartesian = (angle) => ({
    x: cx + radius * Math.cos(toRad(angle)),
    y: cy + radius * Math.sin(toRad(angle)),
  })

  const describeArc = (startDeg, endDeg) => {
    const s = polarToCartesian(startDeg)
    const e = polarToCartesian(endDeg)
    const large = endDeg - startDeg > 180 ? 1 : 0
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${large} 1 ${e.x} ${e.y}`
  }

  const endAngle = startAngle + totalArc * pct
  const pctVal = Math.round(pct * 100)

  let color = '#22c55e'
  if (pctVal >= 70) color = '#ef4444'
  else if (pctVal >= 40) color = '#f59e0b'

  const trackEnd = startAngle + totalArc
  const trackPath = describeArc(startAngle, trackEnd)
  const fillPath = pct > 0 ? describeArc(startAngle, endAngle) : null

  return (
    <svg width={size} height={size * 0.85} viewBox={`0 0 ${size} ${size * 0.85}`}>
      {/* Track */}
      <path
        d={trackPath}
        stroke="#e5e7eb"
        strokeWidth="10"
        fill="none"
        strokeLinecap="round"
        className="dark:stroke-gray-700"
      />
      {/* Fill */}
      {fillPath && (
        <path
          d={fillPath}
          stroke={color}
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
        />
      )}
      {/* Percentage label */}
      <text
        x={cx}
        y={cy + 6}
        textAnchor="middle"
        fontSize="20"
        fontWeight="700"
        fill={color}
      >
        {pctVal}%
      </text>
      <text
        x={cx}
        y={cy + 22}
        textAnchor="middle"
        fontSize="9"
        fill="#9ca3af"
      >
        FRAUD RISK
      </text>
    </svg>
  )
}
