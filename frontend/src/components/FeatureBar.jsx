import React from 'react'

const FEATURE_LABELS = {
  amt: 'Amount (MUR)',
  hour_of_day: 'Hour of Day',
  distance_from_home: 'Distance from Home',
  category: 'Merchant Category',
  age: 'Cardholder Age',
  amt_zscore: 'Amount Z-Score',
  gender: 'Gender',
}

export default function FeatureBar({ features = [] }) {
  const maxAbs = Math.max(...features.map(f => Math.abs(f.shap)), 0.001)

  return (
    <div className="space-y-2">
      {features.map((f) => {
        const pct = (Math.abs(f.shap) / maxAbs) * 100
        const isRisk = f.shap > 0
        return (
          <div key={f.feature} className="flex items-center gap-2 text-sm">
            <span className="w-36 text-right text-gray-600 dark:text-gray-400 truncate flex-shrink-0">
              {FEATURE_LABELS[f.feature] || f.feature}
            </span>
            <div className="flex-1 flex items-center gap-1">
              <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${isRisk ? 'bg-red-500' : 'bg-green-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <span className={`w-14 text-right text-xs font-mono ${isRisk ? 'text-red-600' : 'text-green-600'}`}>
              {isRisk ? '+' : ''}{f.shap.toFixed(3)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
