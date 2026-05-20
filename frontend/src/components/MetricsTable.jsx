import React from 'react'

const MODEL_LABELS = { lr: 'Logistic Regression', rf: 'Random Forest', xgb: 'XGBoost' }
const METRICS = ['accuracy', 'precision', 'recall', 'f1', 'auc_roc']

export default function MetricsTable({ metrics = {} }) {
  if (!metrics || Object.keys(metrics).length === 0) {
    return <p className="text-sm text-gray-500">No metrics available yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="text-left py-2 pr-4 font-medium text-gray-500 dark:text-gray-400">Model</th>
            {METRICS.map(m => (
              <th key={m} className="text-right py-2 px-2 font-medium text-gray-500 dark:text-gray-400 capitalize">
                {m === 'auc_roc' ? 'AUC-ROC' : m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(metrics).map(([key, vals]) => (
            <tr key={key} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className="py-2 pr-4 font-medium">{MODEL_LABELS[key] || key}</td>
              {METRICS.map(m => {
                const v = vals[m] ?? '—'
                const pct = typeof v === 'number' ? Math.round(v * 100) : null
                return (
                  <td key={m} className="text-right py-2 px-2">
                    <span className={`${pct !== null && pct >= 90 ? 'text-green-600' : pct !== null && pct >= 75 ? 'text-amber-600' : 'text-gray-700 dark:text-gray-300'}`}>
                      {pct !== null ? `${pct}%` : v}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
