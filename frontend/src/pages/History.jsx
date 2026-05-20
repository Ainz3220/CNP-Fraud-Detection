import React, { useEffect, useState, useCallback } from 'react'
import { getHistory, submitFeedback } from '../services/api'
import ExplanationCard from '../components/ExplanationCard'
import toast from 'react-hot-toast'

const VERDICT_STYLES = {
  'FRAUD BLOCKED': 'verdict-fraud',
  'REVIEW REQUIRED': 'verdict-review',
  'APPROVED': 'verdict-safe',
}

const MODEL_LABELS = { lr: 'Logistic Regression', rf: 'Random Forest', xgb: 'XGBoost' }

function Pagination({ page, pages, onChange }) {
  return (
    <div className="flex items-center gap-2 justify-center">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="btn-secondary px-3 py-1 text-sm disabled:opacity-40"
      >
        ‹
      </button>
      <span className="text-sm text-gray-600 dark:text-gray-400">
        Page {page} of {pages}
      </span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= pages}
        className="btn-secondary px-3 py-1 text-sm disabled:opacity-40"
      >
        ›
      </button>
    </div>
  )
}

const FEEDBACK_LABELS = { 0: 'Legitimate', 1: 'Fraud' }

export default function History() {
  const [data, setData] = useState({ items: [], total: 0, page: 1, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [feedbackState, setFeedbackState] = useState({}) // id -> { label, submitting }
  const [filters, setFilters] = useState({
    page: 1,
    limit: 20,
    verdict_filter: '',
    model_filter: '',
    date_from: '',
    date_to: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== '')
      )
      const result = await getHistory(params)
      setData(result)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load() }, [load])

  const updateFilter = (key, val) => setFilters(f => ({ ...f, [key]: val, page: 1 }))
  const setPage = (p) => setFilters(f => ({ ...f, page: p }))

  const handleFeedback = async (id, label) => {
    setFeedbackState(s => ({ ...s, [id]: { label, submitting: true } }))
    try {
      await submitFeedback(id, label)
      setFeedbackState(s => ({ ...s, [id]: { label, submitting: false } }))
      toast.success(`Marked as ${FEEDBACK_LABELS[label]}`)
    } catch {
      setFeedbackState(s => ({ ...s, [id]: { label: undefined, submitting: false } }))
    }
  }

  const getAnalystLabel = (row) => {
    const fb = feedbackState[row.id]
    if (fb?.label !== undefined) return fb.label
    return row.analyst_label
  }

  const exportCsv = async () => {
    const params = { ...filters, limit: 10000, page: 1 }
    const result = await getHistory(params)
    const headers = ['id', 'timestamp', 'amount_mur', 'category', 'model_used', 'fraud_probability', 'verdict', 'main_reason']
    const rows = result.items.map(r =>
      headers.map(h => {
        if (h === 'amount_mur') return JSON.stringify((parseFloat(r.amount || 0) * 49).toFixed(2))
        return JSON.stringify(r[h] ?? '')
      }).join(',')
    )
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'prediction_history.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Prediction History</h1>
        <button onClick={exportCsv} className="btn-secondary text-sm flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label">Verdict</label>
            <select className="input" value={filters.verdict_filter} onChange={e => updateFilter('verdict_filter', e.target.value)}>
              <option value="">All</option>
              <option value="FRAUD BLOCKED">Fraud Blocked</option>
              <option value="REVIEW REQUIRED">Review Required</option>
              <option value="APPROVED">Approved</option>
            </select>
          </div>
          <div>
            <label className="label">Model</label>
            <select className="input" value={filters.model_filter} onChange={e => updateFilter('model_filter', e.target.value)}>
              <option value="">All</option>
              <option value="lr">Logistic Regression</option>
              <option value="rf">Random Forest</option>
              <option value="xgb">XGBoost</option>
            </select>
          </div>
          <div>
            <label className="label">From Date</label>
            <input type="date" className="input" value={filters.date_from} onChange={e => updateFilter('date_from', e.target.value)} />
          </div>
          <div>
            <label className="label">To Date</label>
            <input type="date" className="input" value={filters.date_to} onChange={e => updateFilter('date_to', e.target.value)} />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Timestamp</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Amount (MUR)</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Category</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Model</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Fraud Prob.</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Verdict</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Analyst Label</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Main Reason</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full" />
                      Loading...
                    </div>
                  </td>
                </tr>
              ) : data.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">No records found.</td>
                </tr>
              ) : (
                data.items.map(row => {
                  const analystLabel = getAnalystLabel(row)
                  const fb = feedbackState[row.id]
                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer"
                        onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                      >
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                          {row.timestamp ? new Date(row.timestamp).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">MUR {(parseFloat(row.amount || 0) * 49).toFixed(2)}</td>
                        <td className="px-4 py-3 capitalize">{row.category || '—'}</td>
                        <td className="px-4 py-3 uppercase text-xs">{MODEL_LABELS[row.model_used] || row.model_used}</td>
                        <td className="px-4 py-3 text-right font-mono">
                          {row.fraud_probability != null ? `${(row.fraud_probability * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${VERDICT_STYLES[row.verdict] || ''}`}>
                            {row.verdict}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {analystLabel != null ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${analystLabel === 1 ? 'verdict-fraud' : 'verdict-safe'}`}>
                              {FEEDBACK_LABELS[analystLabel]}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{row.main_reason || '—'}</td>
                      </tr>
                      {expanded === row.id && (
                        <tr className="bg-gray-50 dark:bg-gray-800/30">
                          <td colSpan={8} className="px-6 py-4 space-y-4">
                            <ExplanationCard explanation={row.explanation} />
                            <div className="flex items-center gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                              <span className="text-xs font-medium text-gray-500">Analyst Feedback:</span>
                              <button
                                disabled={fb?.submitting}
                                onClick={e => { e.stopPropagation(); handleFeedback(row.id, 1) }}
                                className={`text-xs px-3 py-1 rounded font-medium border transition-colors ${
                                  analystLabel === 1
                                    ? 'bg-red-100 border-red-400 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                    : 'border-gray-300 hover:bg-red-50 hover:border-red-400 hover:text-red-700 dark:border-gray-600 dark:hover:bg-red-900/20'
                                } disabled:opacity-50`}
                              >
                                Mark as Fraud
                              </button>
                              <button
                                disabled={fb?.submitting}
                                onClick={e => { e.stopPropagation(); handleFeedback(row.id, 0) }}
                                className={`text-xs px-3 py-1 rounded font-medium border transition-colors ${
                                  analystLabel === 0
                                    ? 'bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    : 'border-gray-300 hover:bg-green-50 hover:border-green-400 hover:text-green-700 dark:border-gray-600 dark:hover:bg-green-900/20'
                                } disabled:opacity-50`}
                              >
                                Mark as Legitimate
                              </button>
                              {fb?.submitting && <span className="text-xs text-gray-400">Saving...</span>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {data.pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
            <Pagination page={data.page} pages={data.pages} onChange={setPage} />
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 text-center">{data.total} total records</p>
    </div>
  )
}
