import axios from 'axios'
import toast from 'react-hot-toast'

export const MUR_TO_USD = 49

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 120000,
})

api.interceptors.response.use(
  res => res,
  err => {
    const msg = err.response?.data?.detail || err.message || 'An error occurred'
    toast.error(msg)
    return Promise.reject(err)
  }
)

export const getStatus = async () => {
  const { data } = await api.get('/api/status')
  return data
}

export const getMetrics = async () => {
  const { data } = await api.get('/api/metrics')
  return data
}

export const predictTransaction = async (transaction, models = 'lr,rf,xgb') => {
  const { data } = await api.post(`/api/predict?models=${models}`, transaction)
  return data
}

export const predictBatch = async (file, models = 'lr,rf,xgb') => {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post(`/api/predict/batch?models=${models}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    responseType: 'blob',
  })
  return data
}

export const retrainModels = async (file) => {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post('/api/retrain', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export const getHistory = async (params = {}) => {
  const { data } = await api.get('/api/history', { params })
  return data
}

export const getHistoryStats = async () => {
  const { data } = await api.get('/api/history/stats')
  return data
}

export const submitFeedback = async (predictionId, label) => {
  const { data } = await api.post(`/api/feedback/${predictionId}?label=${label}`)
  return data
}

/**
 * Stream batch prediction progress via SSE.
 * onProgress(processed, total) called for each progress event.
 * Returns a Promise that resolves to the CSV Blob when done.
 */
export const predictBatchStream = (file, models = 'lr,rf,xgb', onProgress) => {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('file', file)

    const baseUrl = import.meta.env.VITE_API_URL || ''
    fetch(`${baseUrl}/api/predict/batch/stream?models=${models}`, {
      method: 'POST',
      body: formData,
    })
      .then(response => {
        if (!response.ok) {
          return response.json().then(d => { throw new Error(d.detail || 'Batch stream failed') })
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        function pump() {
          reader.read().then(({ done, value }) => {
            if (done) return
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() // keep incomplete line
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              try {
                const event = JSON.parse(line.slice(6))
                if (event.type === 'progress' && onProgress) {
                  onProgress(event.processed, event.total)
                } else if (event.type === 'done') {
                  resolve(new Blob([event.csv], { type: 'text/csv' }))
                  return
                }
              } catch (e) { console.warn('SSE parse error:', e, line) }
            }
            pump()
          }).catch(reject)
        }
        pump()
      })
      .catch(err => {
        toast.error(err.message || 'Batch stream error')
        reject(err)
      })
  })
}

export default api
