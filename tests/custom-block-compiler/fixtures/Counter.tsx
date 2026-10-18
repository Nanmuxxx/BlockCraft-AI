// Trusted developer-authored fixture. Compile only; no execution in this delivery.
import React, { useState } from 'react'

export default function Counter({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial)
  return <section aria-label="Counter">
    <output aria-live="polite">{count}</output>
    <button onClick={() => setCount(value => value + 1)}>Increment</button>
    <button onClick={() => setCount(initial)}>Reset</button>
  </section>
}
