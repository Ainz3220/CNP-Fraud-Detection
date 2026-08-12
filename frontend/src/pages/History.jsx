import React, { useEffect, useState, useCallback } from 'react'
import { getHistory, MUR_TO_USD } from '../services/api'

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
      <span className="text-sm text-gray-600">
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

export default function History() {
  const [data, setData] = useState({ items: [], total: 0, page: 1, pages: 1 })
  const [loading, setLoading] = useState(true)
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

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Prediction History</h1>
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
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Timestamp</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Amount (MUR)</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Category</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Model</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Fraud Prob.</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full" />
                      Loading...
                    </div>
                  </td>
                </tr>
              ) : data.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">No records found.</td>
                </tr>
              ) : (
                data.items.map(row => (
                  <tr key={row.id} className="border-b border-gray-100">
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {row.timestamp ? new Date(row.timestamp).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">MUR {(parseFloat(row.amount || 0) * MUR_TO_USD).toFixed(2)}</td>
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data.pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100">
            <Pagination page={data.page} pages={data.pages} onChange={setPage} />
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 text-center">{data.total} total records</p>
    </div>
  )
}
