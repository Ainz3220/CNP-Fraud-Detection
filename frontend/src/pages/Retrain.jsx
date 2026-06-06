import React, { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { retrainModels } from '../services/api'
import toast from 'react-hot-toast'

const STATUS_STEPS = [
  'Merging datasets...',
  'Applying SMOTE...',
  'Training Logistic Regression...',
  'Training Random Forest...',
  'Training XGBoost...',
  'Evaluating models...',
  'Saving models...',
]

const SCHEMA_COLS = [
  'trans_date_trans_time', 'cc_num', 'merchant', 'category', 'amt',
  'gender', 'city', 'zip', 'lat', 'long',
  'job', 'dob', 'trans_num', 'unix_time', 'merch_lat', 'merch_long', 'is_fraud',
]

const MetricDiff = ({ label, before, after }) => {
  const b = typeof before === 'number' ? Math.round(before * 100) : null
  const a = typeof after === 'number' ? Math.round(after * 100) : null
  const diff = b !== null && a !== null ? a - b : null
  return (
    <tr className="border-b border-gray-100">
      <td className="py-1.5 pr-4 capitalize text-sm">{label === 'auc_roc' ? 'AUC-ROC' : label}</td>
      <td className="py-1.5 pr-4 text-sm text-right">{b !== null ? `${b}%` : '—'}</td>
      <td className="py-1.5 pr-4 text-sm text-right">{a !== null ? `${a}%` : '—'}</td>
      <td className="py-1.5 text-right text-sm font-semibold">
        {diff !== null ? (
          <span className={diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-500'}>
            {diff > 0 ? '+' : ''}{diff}%
          </span>
        ) : '—'}
      </td>
    </tr>
  )
}

export default function Retrain() {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [stepIdx, setStepIdx] = useState(-1)
  const [comparison, setComparison] = useState(null)

  const onDrop = useCallback((accepted) => {
    if (accepted.length > 0) setFile(accepted[0])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false,
  })

  const handleRetrain = async () => {
    if (!file) return
    setLoading(true)
    setComparison(null)
    setStepIdx(0)

    // Simulate step progress while waiting for server response
    const interval = setInterval(() => {
      setStepIdx(i => Math.min(i + 1, STATUS_STEPS.length - 1))
    }, 3001)

    try {
      const result = await retrainModels(file)
      clearInterval(interval)
      setStepIdx(STATUS_STEPS.length)
      setComparison(result)
      toast.success('Models retrained successfully!')
    } catch {
      clearInterval(interval)
      // error shown by interceptor
    } finally {
      setLoading(false)
    }
  }

  const MODEL_LABELS = { lr: 'Logistic Regression', rf: 'Random Forest', xgb: 'XGBoost' }
  const METRICS = ['accuracy', 'precision', 'recall', 'f1', 'auc_roc']

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Retrain Models</h1>

      {/* Instructions */}
      <div className="card bg-blue-50 border-blue-200">
        <h2 className="font-semibold mb-2 text-blue-800">Required CSV Format</h2>
        <p className="text-sm text-blue-700 mb-3">
          Upload a CSV file containing new labelled transaction data. It must include the <code className="bg-blue-100 px-1 rounded">is_fraud</code> column and these fields:
        </p>
        <div className="flex flex-wrap gap-1">
          {SCHEMA_COLS.map(c => (
            <code
              key={c}
              className={`text-xs px-2 py-0.5 rounded ${c === 'is_fraud' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-700'}`}
            >
              {c}
            </code>
          ))}
        </div>
      </div>

      <div className="card space-y-5">
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            isDragActive
              ? 'border-indigo-500 bg-indigo-50'
              : 'border-gray-300 hover:border-indigo-400'
          }`}
        >
          <input {...getInputProps()} />
          <svg className="w-10 h-10 mx-auto mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          {file ? (
            <p className="font-medium text-indigo-600">{file.name}</p>
          ) : (
            <p className="font-medium">Drop your labelled CSV here or click to browse</p>
          )}
        </div>

        {loading && (
          <div className="space-y-2">
            {STATUS_STEPS.map((step, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                {i < stepIdx ? (
                  <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : i === stepIdx ? (
                  <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-gray-300 flex-shrink-0" />
                )}
                <span className={i <= stepIdx ? 'text-gray-800' : 'text-gray-400'}>
                  {step}
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleRetrain}
          disabled={!file || loading}
          className="btn-primary w-full"
        >
          {loading ? 'Retraining...' : 'Start Retraining'}
        </button>
      </div>

      {/* Comparison */}
      {comparison && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Before / After Comparison</h2>
          {Object.entries(comparison).map(([key, val]) => (
            <div key={key} className="card">
              <h3 className="font-medium mb-3">{MODEL_LABELS[key] || key}</h3>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 text-xs text-gray-500">
                    <th className="text-left py-2 pr-4">Metric</th>
                    <th className="text-right py-2 pr-4">Before</th>
                    <th className="text-right py-2 pr-4">After</th>
                    <th className="text-right py-2">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map(m => (
                    <MetricDiff
                      key={m}
                      label={m}
                      before={val.before?.[m]}
                      after={val.after?.[m]}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
