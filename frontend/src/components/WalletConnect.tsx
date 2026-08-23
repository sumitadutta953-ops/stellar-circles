import React, { useState } from 'react';
import { trackEvent, captureError } from '../services/analytics';
import '../styles/index.css';

interface WalletConnectProps {
  onConnect: (address: string, method: 'passkey' | 'freighter') => void;
}

export const WalletConnect: React.FC<WalletConnectProps> = ({ onConnect }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>('');

  const handlePasskeyConnect = async () => {
    setIsLoading(true);
    setError(null);
    setStatusText('Prompting for passkey…');
    trackEvent('Connect Wallet Clicked', { method: 'passkey' });
    try {
      const { createPasskeyCredential } = await import('../services/passkey');
      const StellarSdk = await import('@stellar/stellar-sdk');
      const credentialId = await createPasskeyCredential();
      setStatusText('Generating wallet…');
      const keypair = StellarSdk.Keypair.random();
      const publicKey = keypair.publicKey();
      const secret = keypair.secret();
      localStorage.setItem(`passkey_secret_${publicKey}`, secret);
      localStorage.setItem(`passkey_credential_${publicKey}`, credentialId);
      setStatusText('Funding with testnet XLM…');
      try {
        const response = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
        const responseJSON = await response.json();
        if (!response.ok) throw new Error(responseJSON.detail || 'Friendbot failed');
      } catch (fundErr: any) {
        console.warn('Friendbot warning:', fundErr);
      }
      onConnect(publicKey, 'passkey');
      trackEvent('Wallet Connected', { method: 'passkey', address: publicKey });
    } catch (err: any) {
      setError(err.message || 'Passkey creation failed');
      captureError(err, { context: 'Passkey Connect' });
    } finally {
      setIsLoading(false);
      setStatusText('');
    }
  };

  const handleFreighterConnect = async () => {
    setIsLoading(true);
    setError(null);
    setStatusText('Connecting Freighter…');
    trackEvent('Connect Wallet Clicked', { method: 'freighter' });
    try {
      const freighter = await import('@stellar/freighter-api');
      const { isConnected } = await freighter.isConnected();
      if (!isConnected) throw new Error('Freighter extension not found. Please install it first.');
      const networkDetails = await freighter.getNetworkDetails();
      if (networkDetails.network !== 'TESTNET') alert('Please switch Freighter to Testnet');
      const { address, error } = await freighter.requestAccess();
      if (error || !address) throw new Error(error || 'User cancelled or no address returned');
      onConnect(address, 'freighter');
      trackEvent('Wallet Connected', { method: 'freighter', address });
    } catch (err: any) {
      setError(err.message || 'Freighter connection failed');
      captureError(err, { context: 'Freighter Connect' });
    } finally {
      setIsLoading(false);
      setStatusText('');
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-6)',
      background: 'var(--c-base)',
    }}>
      {/* Background glow */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -65%)',
        width: 600, height: 600,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{
        width: '100%',
        maxWidth: 380,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)',
        position: 'relative',
      }}>
        {/* Logo mark */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-2)' }}>
          <div style={{
            width: 72, height: 72,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366F1 0%, #A78BFA 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 36, color: '#fff',
            margin: '0 auto var(--space-5)',
            boxShadow: '0 0 40px rgba(99,102,241,0.35), 0 0 0 1px rgba(99,102,241,0.2)',
          }}>
            ◎
          </div>
          <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, letterSpacing: '-0.04em', marginBottom: 8 }}>
            Stellar<span style={{ color: '#818CF8' }}>Circles</span>
          </h1>
          <p style={{ color: 'var(--c-text-sub)', fontSize: 'var(--text-base)', lineHeight: 1.5 }}>
            Rotating savings groups,<br />secured on the blockchain.
          </p>
        </div>

        {/* Auth card */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Error */}
          {error && (
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--c-danger-dim)',
              border: '1px solid rgba(248,113,113,0.2)',
              borderRadius: 'var(--border-radius-md)',
              color: 'var(--c-danger)',
              fontSize: 'var(--text-sm)',
            }}>
              {error}
            </div>
          )}

          {isLoading ? (
            /* Loading state */
            <div style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
              <div style={{
                width: 40, height: 40,
                borderRadius: '50%',
                border: '3px solid var(--c-surface-3)',
                borderTopColor: 'var(--c-primary)',
                animation: 'spin 0.8s linear infinite',
                margin: '0 auto var(--space-4)',
              }} />
              <p style={{ color: 'var(--c-text-sub)', fontSize: 'var(--text-sm)', fontWeight: 500 }}>
                {statusText || 'Connecting…'}
              </p>
            </div>
          ) : (
            <>
              {/* Passkey button */}
              <button
                className="btn btn-primary"
                onClick={handlePasskeyConnect}
                style={{ width: '100%', padding: 'var(--space-4)', flexDirection: 'column', gap: 4, height: 'auto', borderRadius: 'var(--border-radius-lg)' }}
              >
                <span style={{ fontSize: 22, marginBottom: 2 }}>🔑</span>
                <span style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>Continue with Passkey</span>
                <span style={{ fontSize: 'var(--text-xs)', opacity: 0.75, fontWeight: 400 }}>
                  Face ID · Touch ID · Windows Hello · No seed phrase
                </span>
              </button>

              {/* Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)', fontWeight: 500 }}>or</span>
                <div style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
              </div>

              {/* Freighter button */}
              <button
                className="btn btn-secondary"
                onClick={handleFreighterConnect}
                style={{ width: '100%', padding: '12px', borderRadius: 'var(--border-radius-lg)', gap: 8 }}
              >
                <span style={{ fontSize: 18 }}>🌊</span>
                <span>Connect Freighter Wallet</span>
              </button>
            </>
          )}
        </div>

        {/* Trust signal */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)', lineHeight: 1.6 }}>
            Running on <strong style={{ color: 'var(--c-text-sub)' }}>Stellar Testnet</strong> · Open source · Non-custodial
          </p>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
