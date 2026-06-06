import React, { useEffect, useState } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ComposedChart,
} from 'recharts'
import { getMetrics, getHistoryStats, getHistory, MUR_TO_USD } from '../services/api'
import MetricsTable from '../components/MetricsTable'

const MODEL_COLORS = { lr: '#6366f1', rf: '#10b981', xgb: '#f59e0b' }
const MODEL_NAMES = { lr: 'Logistic Reg.', rf: 'Random Forest', xgb: 'XGBoost' }

function ConfusionMatrix({ cm, label }) {
  if (!cm) return null
  const { tn = 0, fp = 0, fn = 0, tp = 0 } = cm
  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-xs font-semibold text-gray-600 mb-1">{label}</p>
      <div className="grid grid-cols-2 gap-px bg-gray-200 text-xs text-center w-40 rounded overflow-hidden">
        <div className="bg-green-50 p-2">
          <div className="font-bold text-green-700">{tp}</div>
          <div className="text-gray-500">TP</div>
        </div>
        <div className="bg-red-50 p-2">
          <div className="font-bold text-red-600">{fp}</div>
          <div className="text-gray-500">FP</div>
        </div>
        <div className="bg-red-50 p-2">
          <div className="font-bold text-red-600">{fn}</div>
          <div className="text-gray-500">FN</div>
        </div>
        <div className="bg-green-50 p-2">
          <div className="font-bold text-green-700">{tn}</div>
          <div className="text-gray-500">TN</div>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-1">Predicted →</p>
    </div>
  )
}

const StatCard = ({ label, value, sub, color }) => (
  <div className="card">
    <p className="text-sm text-gray-500">{label}</p>
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
        const [metrics, stats, history] = await Promise.all([
          getMetrics().catch(() => ({})),
          getHistoryStats().catch(() => null),
          getHistory({ limit: 5 }).catch(() => ({ items: [] })),
        ])
        setMetrics(metrics)
        setStats(stats)
        setRecent(history.items || [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const barData = Object.entries(metrics)
    .filter(([key]) => ['lr', 'rf', 'xgb'].includes(key))
    .map(([key, vals]) => ({
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
        <div className="card bg-amber-50 border-amber-200">
          <div className="flex items-center gap-3">
            <div className="animate-spin w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full" />
            <p className="text-amber-700 text-sm font-medium">
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

      {/* PR Curves + Confusion Matrices */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-base font-semibold mb-1">Precision-Recall Curves</h2>
          <p className="text-xs text-gray-400 mb-4">Higher area = better fraud detection on imbalanced data</p>
          {['lr', 'rf', 'xgb'].some(k => metrics[k]?.pr_curve?.length > 0) ? (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" dataKey="recall" domain={[0, 1]} tick={{ fontSize: 10 }} label={{ value: 'Recall', position: 'insideBottom', offset: -2, fontSize: 11 }} />
                <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} label={{ value: 'Precision', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                <Tooltip formatter={(v) => v?.toFixed ? v.toFixed(3) : v} labelFormatter={v => `Recall: ${Number(v).toFixed(3)}`} />
                <Legend />
                {['lr', 'rf', 'xgb'].map(key =>
                  metrics[key]?.pr_curve ? (
                    <Line
                      key={key}
                      data={metrics[key].pr_curve}
                      type="monotone"
                      dataKey="precision"
                      stroke={MODEL_COLORS[key]}
                      strokeWidth={2}
                      dot={false}
                      name={`${MODEL_NAMES[key]} (PR-AUC: ${metrics[key].pr_auc ?? '—'})`}
                    />
                  ) : null
                )}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
              Train models to see PR curves.
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-base font-semibold mb-1">Confusion Matrices</h2>
          <p className="text-xs text-gray-400 mb-4">At F1-optimal threshold per model</p>
          {['lr', 'rf', 'xgb'].some(k => metrics[k]?.confusion_matrix) ? (
            <div className="flex justify-around items-center flex-wrap gap-4 py-2">
              {['lr', 'rf', 'xgb'].map(key =>
                metrics[key]?.confusion_matrix ? (
                  <ConfusionMatrix
                    key={key}
                    cm={metrics[key].confusion_matrix}
                    label={`${MODEL_NAMES[key]} (t=${metrics[key].optimal_threshold ?? '—'})`}
                  />
                ) : null
              )}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
              Train models to see confusion matrices.
            </div>
          )}
        </div>
      </div>

      {/* Model Card */}
      {metrics._meta && (
        <div className="card">
          <h2 className="text-base font-semibold mb-4">Model Card</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500 mb-1">Last Trained</p>
              <p className="font-medium">{metrics._meta.trained_at ? new Date(metrics._meta.trained_at).toLocaleString() : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Training Samples</p>
              <p className="font-medium">{metrics._meta.n_samples?.toLocaleString() ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Fraud / Legit Split</p>
              <p className="font-medium">
                <span className="text-red-600">{metrics._meta.n_fraud?.toLocaleString() ?? '—'} fraud</span>
                {' / '}
                <span className="text-green-600">{metrics._meta.n_legit?.toLocaleString() ?? '—'} legit</span>
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-gray-500 mb-1">Features ({metrics._meta.features?.length ?? 0})</p>
              <div className="flex flex-wrap gap-1">
                {(metrics._meta.features ?? []).map(f => (
                  <span key={f} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
                    {f}
                  </span>
                ))}
              </div>
            </div>
            <div className="sm:col-span-full">
              <p className="text-xs text-gray-500 mb-1">Optimal Thresholds (F1-maximizing)</p>
              <div className="flex flex-wrap gap-3">
                {['lr', 'rf', 'xgb'].map(key => metrics[key]?.optimal_threshold != null && (
                  <span key={key} className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
                    {MODEL_NAMES[key]}: {metrics[key].optimal_threshold}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent predictions */}
      <div className="card">
        <h2 className="text-base font-semibold mb-4">Recent Predictions</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-400">No predictions yet. Head to the Predict page to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="py-2 pr-4 font-medium text-gray-500">Time</th>
                  <th className="py-2 pr-4 font-medium text-gray-500">Amount (MUR)</th>
                  <th className="py-2 pr-4 font-medium text-gray-500">Category</th>
                  <th className="py-2 pr-4 font-medium text-gray-500">Model</th>
                  <th className="py-2 font-medium text-gray-500">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(r => (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className="py-2 pr-4 text-gray-500 text-xs">
                      {r.timestamp ? new Date(r.timestamp).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 pr-4">MUR {(parseFloat(r.amount || 0) * MUR_TO_USD).toFixed(2)}</td>
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
