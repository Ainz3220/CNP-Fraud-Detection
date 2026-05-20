import React, { useState } from 'react'
import ModelSelector from '../components/ModelSelector'
import PredictionResult from '../components/PredictionResult'
import { predictTransaction } from '../services/api'
import toast from 'react-hot-toast'

const CATEGORIES = [
  'grocery_pos', 'shopping_net', 'gas_transport', 'entertainment',
  'food_dining', 'health_fitness', 'home', 'kids_pets', 'misc_net',
  'misc_pos', 'personal_care', 'shopping_pos', 'travel',
]

const DEFAULT_FORM = {
  amt: '',
  category: 'grocery_pos',
  hour_of_day: 12,
  age: '',
  distance_from_home: '',
  gender: 'M',
}

export default function Predict({ modelsLoaded }) {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [selectedModels, setSelectedModels] = useState(['lr', 'rf', 'xgb'])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const handleChange = (field, val) => setForm(f => ({ ...f, [field]: val }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!modelsLoaded) {
      toast.error('Models are still loading. Please wait.')
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const payload = {
        ...form,
        amt: parseFloat(form.amt) / 49,
        hour_of_day: parseInt(form.hour_of_day),
        age: parseInt(form.age) || 40,
        distance_from_home: form.distance_from_home !== '' ? parseFloat(form.distance_from_home) : null,
      }
      const res = await predictTransaction(payload, selectedModels.join(','))
      setResult(res)
      toast.success('Prediction complete')
    } catch {
      // error shown by interceptor
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Single Transaction Predict</h1>

      <div className="card">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Transaction Amount (MUR)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="e.g. 7350.00"
                className="input"
                value={form.amt}
                onChange={e => handleChange('amt', e.target.value)}
              />
            </div>

            <div>
              <label className="label">Merchant Category</label>
              <select className="input" value={form.category} onChange={e => handleChange('category', e.target.value)}>
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Transaction Hour: {form.hour_of_day}:00</label>
              <input
                type="range"
                min="0"
                max="23"
                className="w-full accent-indigo-600"
                value={form.hour_of_day}
                onChange={e => handleChange('hour_of_day', parseInt(e.target.value))}
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span>
              </div>
            </div>

            <div>
              <label className="label">Cardholder Age</label>
              <input
                type="number"
                min="18"
                max="100"
                placeholder="e.g. 35"
                className="input"
                value={form.age}
                onChange={e => handleChange('age', e.target.value)}
              />
            </div>

            <div>
              <label className="label">Distance from Home (miles)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="e.g. 12.5"
                className="input"
                value={form.distance_from_home}
                onChange={e => handleChange('distance_from_home', e.target.value)}
              />
            </div>

            <div>
              <label className="label">Gender</label>
              <select className="input" value={form.gender} onChange={e => handleChange('gender', e.target.value)}>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label mb-2">Select Models</label>
            <ModelSelector selected={selectedModels} onChange={setSelectedModels} />
          </div>

          <button
            type="submit"
            disabled={loading || !modelsLoaded}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Analysing...
              </>
            ) : (
              'Analyse Transaction'
            )}
          </button>
        </form>
      </div>

      <PredictionResult result={result} />
    </div>
  )
}
