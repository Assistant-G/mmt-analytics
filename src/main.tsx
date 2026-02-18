import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initializePriceCache } from '@/services/priceService'

// Initialize price cache immediately on app load to avoid hardcoded fallbacks
initializePriceCache();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
