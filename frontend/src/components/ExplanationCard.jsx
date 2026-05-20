import React from 'react'

const RiskIcon = () => (
  <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
)

const SafeIcon = () => (
  <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
)

export default function ExplanationCard({ explanation }) {
  if (!explanation) return null
  const { risk_factors = [], safe_factors = [], sentences = [] } = explanation

  return (
    <div className="space-y-3">
      {risk_factors.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">Risk Factors</p>
          <ul className="space-y-1.5">
            {risk_factors.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                <RiskIcon />
                <span>{item.sentence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {safe_factors.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-2">Legitimacy Factors</p>
          <ul className="space-y-1.5">
            {safe_factors.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                <SafeIcon />
                <span>{item.sentence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
