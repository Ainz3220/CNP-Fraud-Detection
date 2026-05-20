import axios from 'axios'
import toast from 'react-hot-toast'

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

export default api
