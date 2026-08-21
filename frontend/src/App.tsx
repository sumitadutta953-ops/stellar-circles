import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { WalletConnect } from './components/WalletConnect';
import { initAnalytics } from './services/analytics';
import { CircleCreation } from './pages/CircleCreation';
import { CircleDashboard } from './pages/CircleDashboard';
import { JoinCircle } from './pages/JoinCircle';
import './styles/index.css';

function App() {
    const [wallet, setWallet] = useState<{ address: string; method: string; balance: string } | null>(null);

  const handleConnect = async (address: string, method: string) => {
    const { getNativeBalance } = await import('./services/stellar');
    const balance = await getNativeBalance(address);
    setWallet({ address, method, balance });
  };

  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <Router>
      <div className="container" style={{ paddingTop: 'var(--space-12)' }}>
        <header style={{ marginBottom: 'var(--space-8)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="text-gradient" style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, margin: 0 }}>
              Stellar Circles
            </h1>
            <p className="text-muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>Decentralized Rotating Savings</p>
          </div>
          {wallet && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
              <span className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                <strong style={{ color: 'var(--color-primary-hover)' }}>{parseFloat(wallet.balance).toFixed(2)} XLM</strong>
                <span style={{ opacity: 0.5, margin: '0 var(--space-2)' }}>|</span>
                {wallet.method === 'passkey' ? 'Passkey' : 'Freighter'}: {wallet.address}
              </span>
              <button 
                className="btn btn-secondary" 
                style={{ padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-xs)' }}
                onClick={() => setWallet(null)}
              >
                Disconnect
              </button>
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
              <Route path="/" element={<CircleDashboard walletAddress={wallet.address} />} />
              <Route path="/create" element={<CircleCreation walletAddress={wallet.address} />} />
              <Route path="/join" element={<JoinCircle walletAddress={wallet.address} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </main>
      </div>
    </Router>
  );
}

export default App;
