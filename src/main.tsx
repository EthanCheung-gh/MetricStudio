import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HeroUIProvider } from '@heroui/system'
import App from './App'
import { initLogger } from './utils/logger'
import './i18n'
import './index.css'

// v1.8.0: SPA logging — ring buffer, global error capture, trace ids.
initLogger()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HeroUIProvider>
      <App />
    </HeroUIProvider>
  </StrictMode>,
)
