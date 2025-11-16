export default function HeaderLogo() {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)'
    }}>
      <img src="/vo-logo.png" alt="Verum Omnis" style={{ height: 32 }} />
      <strong>Verum Omnis</strong>
    </header>
  )
}
