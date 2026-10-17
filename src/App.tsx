import { useState } from 'react'
import { Logo } from './components/Logo'
import { Home } from './components/Home'
import { Workshop } from './components/Workshop'
import { createInitialAppConfig, type AppConfig } from './model/appConfig'

export default function App() {
  const [appConfig, setAppConfig] = useState<AppConfig>(() => createInitialAppConfig(''))
  const [started, setStarted] = useState(false)

  if (started) {
    return <Workshop config={appConfig} onConfigChange={setAppConfig} onBack={() => setStarted(false)} />
  }

  return (
    <div className="app">
      <div className="app__bg" aria-hidden="true" />
      <header className="topbar">
        <Logo />
        <span className="topbar__tag">
          <span className="pixel-dot" aria-hidden="true" />
          Demo 预览版
        </span>
      </header>
      <main className="main">
        <Home onStart={(idea) => { setAppConfig(createInitialAppConfig(idea)); setStarted(true) }} />
      </main>
      <footer className="footer">BlockCraft AI · 把想法，搭成现实</footer>
    </div>
  )
}
