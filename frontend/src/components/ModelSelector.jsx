import React from 'react'

const MODEL_INFO = {
  lr: { label: 'Logistic Regression', badge: 'Baseline', color: 'indigo' },
  rf: { label: 'Random Forest', badge: 'Main', color: 'violet' },
  xgb: { label: 'XGBoost', badge: 'Advanced', color: 'purple' },
}

export default function ModelSelector({ selected, onChange }) {
  const toggle = (key) => {
    const next = selected.includes(key)
      ? selected.filter(m => m !== key)
      : [...selected, key]
    if (next.length > 0) onChange(next)
  }

  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(MODEL_INFO).map(([key, info]) => {
        const active = selected.includes(key)
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
              active
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            <span>{info.label}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
              active
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-200 text-gray-500'
            }`}>
              {info.badge}
            </span>
          </button>
        )
      })}
    </div>
  )
}
