import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/pixelify-sans/latin-500.css'
import '@fontsource/pixelify-sans/latin-700.css'
import './styles.css'
import App from './App'
import { AppRendererDemo } from './components/app-renderer/AppRendererDemo'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname === '/app-renderer' ? <AppRendererDemo /> : <App />}
  </StrictMode>,
)
