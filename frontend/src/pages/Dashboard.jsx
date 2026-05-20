import React, { useEffect, useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { getMetrics, getHistoryStats, getHistory } from '../services/api'
import MetricsTable from '../components/MetricsTable'

const StatCard = ({ label, value, sub, color }) => (
  <div className="card">
    <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
    <p className={`text-3xl font-bold mt-1 ${color || ''}`}>{value}</p>
    {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
  </div>
)

const VERDICT_STYLES = {
  'FRAUD BLOCKED': 'verdict-fraud',
  'REVIEW REQUIRED': 'verdict-review',
  'APPROVED': 'verdict-safe',
}

export default function Dashboard({ modelsLoaded }) {
  const [metrics, setMetrics] = useState({})
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [m, s, h] = await Promise.all([
          getMetrics().catch(() => ({})),
          getHistoryStats().catch(() => null),
          getHistory({ limit: 5 }).catch(() => ({ items: [] })),
        ])
        setMetrics(m)
        setStats(s)
        setRecent(h.items || [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const barData = Object.entries(metrics).map(([key, vals]) => ({
    model: key === 'lr' ? 'LR' : key === 'rf' ? 'RF' : 'XGB',
    Accuracy: vals.accuracy ? Math.round(vals.accuracy * 100) : 0,
    F1: vals.f1 ? Math.round(vals.f1 * 100) : 0,
    'AUC-ROC': vals.auc_roc ? Math.round(vals.auc_roc * 100) : 0,
  }))

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {!modelsLoaded && (
        <div className="card bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <div className="flex items-center gap-3">
            <div className="animate-spin w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full" />
            <p className="text-amber-700 dark:text-amber-400 text-sm font-medium">
              Models are loading or training for the first time. This may take a few minutes.
            </p>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Predictions" value={stats?.total_predictions ?? 0} />
        <StatCard label="Fraud Detected" value={stats?.fraud_detected ?? 0} color="text-red-600" />
        <StatCard label="Legitimacy Rate" value={`${stats?.legitimacy_rate ?? 0}%`} color="text-green-600" />
        <StatCard label="Models Active" value={modelsLoaded ? 3 : 0} sub="LR · RF · XGBoost" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Trend chart */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4">Fraud vs Legitimate (30 days)</h2>
          {stats?.daily_trend?.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={stats.daily_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="fraud" stroke="#ef4444" strokeWidth={2} dot={false} name="Fraud" />
                <Line type="monotone" dataKey="legitimate" stroke="#22c55e" strokeWidth={2} dot={false} name="Legitimate" />
                <Line type="monotone" dataKey="review" stroke="#f59e0b" strokeWidth={2} dot={false} name="Review" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
              No prediction history yet. Make predictions to see trend data.
            </div>
          )}
        </div>

        {/* Model metrics bar chart */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4">Model Performance</h2>
          {barData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="model" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={v => `${v}%`} />
                <Legend />
                <Bar dataKey="Accuracy" fill="#6366f1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="F1" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="AUC-ROC" fill="#a78bfa" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
              No metrics available yet.
            </div>
          )}
        </div>
      </div>

      {/* Metrics table */}
      <div className="card">
        <h2 className="text-base font-semibold mb-4">Model Metrics</h2>
        <MetricsTable metrics={metrics} />
      </div>

      {/* Recent predictions */}
      <div className="card">
        <h2 className="text-base font-semibold mb-4">Recent Predictions</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-400">No predictions yet. Head to the Predict page to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                  <th className="py-2 pr-4 font-medium text-gray-500">Time</th>
                  <th className="py-2 pr-4 font-medium text-gray-500">Amount</th>
                  <th className="py-2 pr-4 font-medium text-gray-500">Category</th>
                  <th className="py-2 pr-4 font-medium text-gray-500">Model</th>
                  <th className="py-2 font-medium text-gray-500">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 pr-4 text-gray-500 text-xs">
                      {r.timestamp ? new Date(r.timestamp).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 pr-4">${parseFloat(r.amount || 0).toFixed(2)}</td>
                    <td className="py-2 pr-4 capitalize">{r.category || '—'}</td>
                    <td className="py-2 pr-4 uppercase text-xs">{r.model_used}</td>
                    <td className="py-2">
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
    </div>
  )
}
