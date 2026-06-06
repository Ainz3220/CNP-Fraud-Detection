import React, { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import ModelSelector from '../components/ModelSelector'
import { predictBatchStream } from '../services/api'
import toast from 'react-hot-toast'

const VERDICT_STYLES = {
  'FRAUD BLOCKED': 'verdict-fraud',
  'REVIEW REQUIRED': 'verdict-review',
  'APPROVED': 'verdict-safe',
}

export default function BatchPredict({ modelsLoaded }) {
  const [file, setFile] = useState(null)
  const [selectedModels, setSelectedModels] = useState(['lr', 'rf', 'xgb'])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [rows, setRows] = useState([])
  const [csvBlob, setCsvBlob] = useState(null)
  const [stats, setStats] = useState(null)

  const onDrop = useCallback((accepted) => {
    if (accepted.length > 0) setFile(accepted[0])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false,
  })

  const [progressText, setProgressText] = useState('')

  const handleSubmit = async () => {
    if (!file) return
    if (!modelsLoaded) { toast.error('Models are still loading.'); return }

    setLoading(true)
    setProgress(0)
    setProgressText('')
    setRows([])
    setCsvBlob(null)
    setStats(null)

    try {
      const blob = await predictBatchStream(
        file,
        selectedModels.join(','),
        (processed, total) => {
          setProgress(Math.round((processed / total) * 100))
          setProgressText(`${processed} / ${total} rows`)
        }
      )
      setProgress(100)
      setProgressText('Done')
      setCsvBlob(blob)

      const text = await blob.text()
      const lines = text.trim().split('\n')
      const headers = lines[0].split(',')
      const parsed = lines.slice(1, 51).map(line => {
        const vals = line.split(',')
        return Object.fromEntries(headers.map((h, i) => [h.trim(), vals[i]?.trim()]))
      })
      setRows(parsed)

      const verdictCol = 'combined_verdict'
      const allLines = lines.slice(1)
      const headerIdx = headers.indexOf(verdictCol)
      let fraud = 0, review = 0
      allLines.forEach(l => {
        const v = l.split(',')[headerIdx]?.trim()
        if (v === 'FRAUD BLOCKED') fraud++
        else if (v === 'REVIEW REQUIRED') review++
      })
      setStats({ total: allLines.length, fraud, review, safe: allLines.length - fraud - review })
      toast.success('Batch prediction complete')
    } catch {
      // error shown by api.js
    } finally {
      setLoading(false)
    }
  }

  const downloadCsv = () => {
    if (!csvBlob) return
    const url = URL.createObjectURL(csvBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'batch_predictions.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Batch Prediction</h1>

      <div className="card space-y-5">
        {/* Dropzone */}
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
            <>
              <p className="font-medium">Drop your CSV file here or click to browse</p>
              <p className="text-sm text-gray-400 mt-1">Must match the training data schema</p>
            </>
          )}
        </div>

        <div>
          <label className="label mb-2">Select Models</label>
          <ModelSelector selected={selectedModels} onChange={setSelectedModels} />
        </div>

        {loading && (
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>{progressText ? `Processing… ${progressText}` : 'Starting…'}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!file || loading || !modelsLoaded}
          className="btn-primary w-full"
        >
          {loading ? 'Processing...' : 'Run Batch Prediction'}
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="card text-center">
            <p className="text-xs text-gray-500 mb-1">Total Rows</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </div>
          <div className="card text-center verdict-fraud">
            <p className="text-xs opacity-70 mb-1">Fraud Detected</p>
            <p className="text-2xl font-bold">{stats.fraud}</p>
          </div>
          <div className="card text-center verdict-review">
            <p className="text-xs opacity-70 mb-1">Review Required</p>
            <p className="text-2xl font-bold">{stats.review}</p>
          </div>
          <div className="card text-center verdict-safe">
            <p className="text-xs opacity-70 mb-1">Approved</p>
            <p className="text-2xl font-bold">{stats.safe}</p>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold">Results (first 50 rows)</h2>
            <button onClick={downloadCsv} className="btn-secondary text-sm flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download CSV
            </button>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-gray-200">
                  {Object.keys(rows[0]).slice(0, 10).map(h => (
                    <th key={h} className="text-left py-2 pr-3 font-medium text-gray-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    {Object.entries(row).slice(0, 10).map(([k, v]) => (
                      <td key={k} className="py-1.5 pr-3 whitespace-nowrap">
                        {k === 'combined_verdict' ? (
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${VERDICT_STYLES[v] || ''}`}>
                            {v}
                          </span>
                        ) : (
                          v
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
