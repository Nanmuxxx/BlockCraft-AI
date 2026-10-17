import { useState } from 'react'
import { Logo } from './components/Logo'
import { Home } from './components/Home'
import { ClarificationStep } from './components/ClarificationStep'
import { Workshop } from './components/Workshop'
import { createInitialAppConfig, type AppConfig } from './model/appConfig'

type AppStep = 'home' | 'clarification' | 'workshop'

export default function App() {
  const [appConfig, setAppConfig] = useState<AppConfig>(() => createInitialAppConfig(''))
  const [step, setStep] = useState<AppStep>('home')

  if (step === 'workshop') {
    return <Workshop config={appConfig} onConfigChange={setAppConfig} onBack={() => setStep('home')} />
  }

  if (step === 'clarification') {
    return (
      <ClarificationStep
        idea={appConfig.idea}
        onComplete={(choice) => {
          setAppConfig((current) => ({ ...current, clarificationChoice: choice }))
          setStep('workshop')
        }}
        onBack={() => setStep('home')}
      />
    )
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
        <Home
          initialIdea={appConfig.idea}
          onStart={(idea) => {
            setAppConfig(createInitialAppConfig(idea))
            setStep('clarification')
          }}
        />
      </main>
      <footer className="footer">BlockCraft AI · 把想法，搭成现实</footer>
    </div>
  )
}
