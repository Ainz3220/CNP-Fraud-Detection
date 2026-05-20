import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import Dashboard from './pages/Dashboard'
import Predict from './pages/Predict'
import BatchPredict from './pages/BatchPredict'
import Retrain from './pages/Retrain'
import History from './pages/History'
import { getStatus } from './services/api'

export default function App() {
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem('darkMode') === 'true'
  )
  const [modelsLoaded, setModelsLoaded] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('darkMode', darkMode)
  }, [darkMode])

  useEffect(() => {
    const poll = async () => {
      try {
        const status = await getStatus()
        setModelsLoaded(status.models_loaded)
        if (!status.models_loaded) {
          setTimeout(poll, 3001)
        }
      } catch {
        setTimeout(poll, 5000)
      }
    }
    poll()
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar
        darkMode={darkMode}
        toggleDark={() => setDarkMode(d => !d)}
        modelsLoaded={modelsLoaded}
      />
      <main className="flex-1 container mx-auto px-4 py-6 max-w-7xl">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard modelsLoaded={modelsLoaded} />} />
          <Route path="/predict" element={<Predict modelsLoaded={modelsLoaded} />} />
          <Route path="/batch" element={<BatchPredict modelsLoaded={modelsLoaded} />} />
          <Route path="/retrain" element={<Retrain />} />
          <Route path="/history" element={<History />} />
        </Routes>
      </main>
    </div>
  )
}
