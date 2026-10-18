// Trusted developer-authored fixture. Compile only; no execution in this delivery.
import React, { useState } from 'react'
import { fahrenheit } from './convert'

export default function Temperature({ initial }: { initial: number }) {
  const [celsius, setCelsius] = useState(initial)
  return <label>Celsius
    <input type="number" value={celsius} onChange={event => setCelsius(Number(event.target.value))} />
    <output>{fahrenheit(celsius).toFixed(1)} °F</output>
  </label>
}
