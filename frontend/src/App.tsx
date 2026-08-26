import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
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

  // Auto-refresh balance every 15 seconds when wallet is connected
  useEffect(() => {
    if (!wallet?.address) return;
    const interval = setInterval(() => {
      refreshBalance(wallet.address);
    }, 15000);
    return () => clearInterval(interval);
  }, [wallet?.address, refreshBalance]);

  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <Router>
      <div className="container" style={{ paddingTop: 'var(--space-8)' }}>
        <header className="app-header" style={{ marginBottom: 'var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="text-gradient" style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, margin: 0 }}>
              Stellar Circles
            </h1>
            <p className="text-muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>Decentralized Rotating Savings</p>
          </div>
          {wallet && (
            <div className="app-header-wallet" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <span className="app-header-wallet-address text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                <strong style={{ color: 'var(--color-primary-hover)' }}>{parseFloat(wallet.balance).toFixed(2)} XLM</strong>
                <span style={{ opacity: 0.5, margin: '0 var(--space-2)' }}>·</span>
                <span style={{ opacity: 0.7 }}>
                  {wallet.method === 'passkey' ? '🔑' : '🔌'}{' '}
                  {wallet.address.substring(0, 6)}…{wallet.address.substring(wallet.address.length - 4)}
                </span>
              </span>
              <div className="app-header-actions" style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  className="btn btn-secondary"
                  style={{ padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-xs)' }}
                  onClick={() => refreshBalance(wallet.address)}
                  title="Refresh balance"
                >
                  🔄
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-xs)' }}
                  onClick={() => setWallet(null)}
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}
        </header>

        <main>
          {!wallet ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
              <WalletConnect onConnect={handleConnect} />
            </div>
          ) : (
            <Routes>
              <Route path="/" element={<CircleDashboard walletAddress={wallet.address} onTransactionComplete={() => refreshBalance(wallet.address)} />} />
              <Route path="/create" element={<CircleCreation walletAddress={wallet.address} onTransactionComplete={() => refreshBalance(wallet.address)} />} />
              <Route path="/join" element={<JoinCircle walletAddress={wallet.address} onTransactionComplete={() => refreshBalance(wallet.address)} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </main>
      </div>
    </Router>
  );
}

export default App;
