import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { WalletConnect } from './components/WalletConnect';
import { initAnalytics } from './services/analytics';
import { CircleCreation } from './pages/CircleCreation';
import { CircleDashboard } from './pages/CircleDashboard';
import { JoinCircle } from './pages/JoinCircle';
import './styles/index.css';

function App() {
  const [wallet, setWallet] = useState<{ address: string; method: string; balance: string } | null>(null);

  const refreshBalance = useCallback(async (address: string) => {
    const { getNativeBalance } = await import('./services/stellar');
    const balance = await getNativeBalance(address);
    setWallet(prev => prev ? { ...prev, balance } : prev);
  }, []);

  const handleConnect = async (address: string, method: string) => {
    const { getNativeBalance } = await import('./services/stellar');
    const balance = await getNativeBalance(address);
    setWallet({ address, method, balance });
  };

  useEffect(() => {
    if (!wallet?.address) return;
    const id = setInterval(() => refreshBalance(wallet.address), 15000);
    return () => clearInterval(id);
  }, [wallet?.address, refreshBalance]);

  useEffect(() => { initAnalytics(); }, []);

  const short = (addr: string) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;

  /* ── No wallet → fullscreen onboarding ── */
  if (!wallet) {
    return (
      <Router>
        <WalletConnect onConnect={handleConnect} />
      </Router>
    );
  }

  return (
    <Router>
      {/* ────────── STICKY HEADER ────────── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(3,6,15,0.88)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        borderBottom: '1px solid var(--c-border)',
        height: 'var(--header-h)',
      }}>
        <div className="container" style={{
          height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366F1 0%, #A78BFA 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 17, color: '#fff', fontWeight: 700,
            }}>◎</div>
            <span style={{
              fontWeight: 700, fontSize: 'var(--text-base)',
              letterSpacing: '-0.03em', color: 'var(--c-text)',
            }}>
              Stellar<span style={{ color: 'var(--c-purple)' }}>Circles</span>
            </span>
          </div>

          {/* Wallet row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Balance pill */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--c-surface-2)',
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--border-radius-full)',
              padding: '6px 14px',
            }}>
              <div style={{
                width: 7, height: 7, borderRadius: '50%',
                background: 'var(--c-success)',
                animation: 'glow-pulse 2.5s ease-in-out infinite',
              }} />
              <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
                {parseFloat(wallet.balance).toFixed(2)}&nbsp;XLM
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)' }}
                className="desktop-only"
              >{short(wallet.address)}</span>
            </div>

            {/* Refresh */}
            <button className="btn btn-ghost" onClick={() => refreshBalance(wallet.address)}
              title="Refresh balance"
              style={{ padding: 8, borderRadius: 'var(--border-radius-md)', fontSize: 16 }}>
              ⟳
            </button>

            {/* Sign out — desktop only, mobile uses bottom nav */}
            <button
              className="btn btn-secondary desktop-only"
              style={{ padding: '6px 14px', fontSize: 'var(--text-xs)' }}
              onClick={() => setWallet(null)}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* ────────── MAIN CONTENT ────────── */}
      <main
        className="container page-pad-bottom"
        style={{ paddingTop: 'var(--space-6)', minHeight: 'calc(100vh - var(--header-h))' }}
      >
        <Routes>
          <Route path="/"       element={<CircleDashboard walletAddress={wallet.address} onTransactionComplete={() => refreshBalance(wallet.address)} />} />
          <Route path="/create" element={<CircleCreation  walletAddress={wallet.address} onTransactionComplete={() => refreshBalance(wallet.address)} />} />
          <Route path="/join"   element={<JoinCircle      walletAddress={wallet.address} onTransactionComplete={() => refreshBalance(wallet.address)} />} />
          <Route path="*"       element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* ────────── MOBILE BOTTOM NAV ────────── */}
      <nav className="mobile-nav">
        <div className="mobile-nav-inner">
          <NavLink to="/" end className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
            <span>⊙</span><span>Circles</span>
          </NavLink>
          <NavLink to="/create" className="nav-fab" title="Create circle">＋</NavLink>
          <NavLink to="/join" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
            <span>↗</span><span>Join</span>
          </NavLink>
        </div>
      </nav>
    </Router>
  );
}

export default App;
