import React, { useState } from 'react'
import FraudGauge from './FraudGauge'
import ExplanationCard from './ExplanationCard'
import FeatureBar from './FeatureBar'

const VERDICT_STYLES = {
  'FRAUD BLOCKED': 'verdict-fraud',
  'REVIEW REQUIRED': 'verdict-review',
  'APPROVED': 'verdict-safe',
}

const MODEL_BADGE = {
  lr: { label: 'Logistic Regression', badge: 'Baseline' },
  rf: { label: 'Random Forest', badge: 'Main' },
  xgb: { label: 'XGBoost', badge: 'Advanced' },
}

export default function PredictionResult({ result }) {
  const [activeTab, setActiveTab] = useState(0)

  if (!result) return null
  const { model_results = [], combined_verdict } = result

  return (
    <div className="space-y-4 mt-6">
      {/* Combined verdict */}
      {model_results.length > 1 && (
        <div className={`card flex items-center gap-4 ${VERDICT_STYLES[combined_verdict] || ''}`}>
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">Combined Verdict (Majority Vote)</p>
            <p className="text-xl font-bold">{combined_verdict}</p>
          </div>
          <div className="text-4xl">
            {combined_verdict === 'FRAUD BLOCKED' ? '🚫' : combined_verdict === 'REVIEW REQUIRED' ? '⚠️' : '✅'}
          </div>
        </div>
      )}

      {/* Per-model tabs */}
      {model_results.length > 1 && (
        <div className="flex gap-2">
          {model_results.map((r, i) => (
            <button
              key={r.model_name}
              onClick={() => setActiveTab(i)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === i
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {MODEL_BADGE[r.model_name]?.label || r.model_name}
            </button>
          ))}
        </div>
      )}

      {model_results.map((r, i) => (
        <div
          key={r.model_name}
          className={`card ${model_results.length > 1 && i !== activeTab ? 'hidden' : ''}`}
        >
          <div className="flex flex-col sm:flex-row gap-6">
            {/* Gauge */}
            <div className="flex flex-col items-center gap-2 flex-shrink-0">
              <FraudGauge probability={r.fraud_probability} size={140} />
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${VERDICT_STYLES[r.verdict] || ''}`}>
                {r.verdict}
              </span>
              <div className="text-center">
                <p className="text-xs text-gray-500">{MODEL_BADGE[r.model_name]?.label}</p>
                <span className="text-xs bg-gray-100 px-2 py-0.5 rounded font-medium">
                  {MODEL_BADGE[r.model_name]?.badge}
                </span>
              </div>
            </div>

            <div className="flex-1 space-y-4">
              {/* Explanation */}
              <div>
                <h3 className="text-sm font-semibold mb-2">Explanation</h3>
                <ExplanationCard explanation={r.explanation} />
              </div>

              {/* Feature importance */}
              {r.shap_features && r.shap_features.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Feature Contributions</h3>
                  <FeatureBar features={r.shap_features} />
                </div>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Model comparison table */}
      {model_results.length > 1 && (
        <div className="card">
          <h3 className="text-sm font-semibold mb-3">Model Comparison</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 font-medium text-gray-500">Model</th>
                <th className="text-right py-2 font-medium text-gray-500">Fraud Prob.</th>
                <th className="text-right py-2 font-medium text-gray-500">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {model_results.map(r => (
                <tr key={r.model_name} className="border-b border-gray-100">
                  <td className="py-2">{MODEL_BADGE[r.model_name]?.label}</td>
                  <td className="text-right py-2 font-mono">{(r.fraud_probability * 100).toFixed(1)}%</td>
                  <td className="text-right py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${VERDICT_STYLES[r.verdict] || ''}`}>
                      {r.verdict}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
