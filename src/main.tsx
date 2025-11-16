import React from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  return (
    <div style={{color:'#fff', background:'#0a2038', minHeight:'100vh', display:'grid', placeItems:'center'}}>
      <div>
        <h1>Verum Omnis — Scaffold Online</h1>
        <p>Vite → www → Capacitor Android</p>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
