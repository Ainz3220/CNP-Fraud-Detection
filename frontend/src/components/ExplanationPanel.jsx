import React from 'react'
import { MUR_TO_USD } from '../services/api'

const NORMAL_HOURS = { min: 6, max: 21 }

function riskLabel(shap, maxAbs) {
  if (shap <= 0) return 'SUPPORTS LEGITIMACY'
  const ratio = Math.abs(shap) / (maxAbs || 0.001)
  if (ratio >= 0.6) return 'HIGH FRAUD INDICATOR'
  if (ratio >= 0.25) return 'MODERATE FRAUD INDICATOR'
  return 'LOW FRAUD INDICATOR'
}

function fallbackSentence(feature, shap, value) {
  const hour = parseInt(value, 10)
  switch (feature) {
    case 'amt': {
      const mur = (parseFloat(value) * MUR_TO_USD).toFixed(2)
      return shap > 0
        ? `Transaction amount of MUR ${mur} contributed to fraud risk.`
        : `Transaction amount of MUR ${mur} is consistent with legitimate spending.`
    }
    case 'amt_zscore':
      return shap > 0
        ? 'Transaction amount is unusual for this merchant category.'
        : 'Transaction amount is within normal statistical range for this category.'
    case 'hour_of_day': {
      const clock = `${Number.isFinite(hour) ? String(hour).padStart(2, '0') : value}:00`
      if (Number.isFinite(hour) && hour >= NORMAL_HOURS.min && hour <= NORMAL_HOURS.max) {
        return `Transaction occurred at ${clock}, which is within normal hours.`
      }
      return `Transaction occurred at ${clock}, which is outside typical spending hours.`
    }
    case 'distance_from_home': {
      const dist = parseFloat(value)
      if (shap <= 0 || (Number.isFinite(dist) && dist <= 20)) {
        return `Transaction occurred ${Number.isFinite(dist) ? dist.toFixed(1) : value} miles from home, close to the cardholder's usual location.`
      }
      return `Transaction occurred ${Number.isFinite(dist) ? dist.toFixed(1) : value} miles from home, which is unusually far.`
    }
    case 'age':
      return shap > 0
        ? `Cardholder age (${value}) contributed to fraud risk.`
        : `Cardholder age (${value}) is consistent with typical cardholder profiles.`
    case 'gender':
      return shap > 0
        ? `Feature 'gender' (value: ${value}) contributed to fraud risk.`
        : `Feature 'gender' (value: ${value}) supported legitimacy.`
    case 'category':
      return shap > 0
        ? `Merchant category '${value}' contributed to fraud risk.`
        : `Merchant category '${value}' is consistent with legitimate activity.`
    default:
      return shap > 0
        ? `Feature '${feature}' (value: ${value}) contributed to fraud risk.`
        : `Feature '${feature}' (value: ${value}) supported legitimacy.`
  }
}

function fromTopFeatures(features = []) {
  const maxAbs = Math.max(...features.map(f => Math.abs(f.shap)), 0.001)
  const risk_factors = []
  const safe_factors = []
  for (const f of features) {
    const item = {
      feature: f.feature,
      text: fallbackSentence(f.feature, f.shap, f.value),
      label: riskLabel(f.shap, maxAbs),
      shap: f.shap,
    }
    if (f.shap > 0) risk_factors.push(item)
    else if (f.shap < 0) safe_factors.push(item)
  }
  return { risk_factors, safe_factors }
}

function WarningIcon() {
  return (
    <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12V16.5zm-7.66 1.126c-.866 1.5.217 3.374 1.948 3.374h14.424c1.73 0 2.813-1.874 1.948-3.374L13.949 4.378c-.866-1.5-3.032-1.5-3.898 0L4.34 17.626z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}

function FactorList({ items, tone }) {
  if (!items || items.length === 0) return null
  const isRisk = tone === 'risk'
  return (
    <div>
      <h4 className={`text-xs font-bold tracking-wide mb-3 ${isRisk ? 'text-red-600' : 'text-green-600'}`}>
        {isRisk ? 'RISK FACTORS' : 'LEGITIMACY FACTORS'}
      </h4>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={`${item.feature}-${i}`} className="flex items-start gap-2.5">
            {isRisk ? <WarningIcon /> : <CheckIcon />}
            <p className="text-sm text-gray-800 leading-relaxed">
              {item.text.replace(/\.*$/, '.')}{' '}
              <span className="font-bold">{item.label}.</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function ExplanationPanel({ explanation, topFeatures = [] }) {
  const hasServer =
    explanation &&
    ((explanation.risk_factors && explanation.risk_factors.length > 0) ||
      (explanation.safe_factors && explanation.safe_factors.length > 0))

  const data = hasServer ? explanation : fromTopFeatures(topFeatures)
  const risk = data.risk_factors || []
  const safe = data.safe_factors || []

  if (risk.length === 0 && safe.length === 0) return null

  return (
    <div className="flex-1 min-w-0">
      <h3 className="text-lg font-bold mb-4">Explanation</h3>
      <div className="space-y-5">
        <FactorList items={risk} tone="risk" />
        <FactorList items={safe} tone="safe" />
      </div>
    </div>
  )
}
