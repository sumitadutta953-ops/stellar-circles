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
    setStatusText('Prompting for Passkey...');
    trackEvent('Connect Wallet Clicked', { method: 'passkey' });

    try {
      const { createPasskeyCredential } = await import('../services/passkey');
      const StellarSdk = await import('@stellar/stellar-sdk');

      // 1. Trigger native WebAuthn passkey prompt
      const credentialId = await createPasskeyCredential();
      
      setStatusText('Generating secure wallet...');
      
      // 2. Generate an Ed25519 wallet that is tied to this passkey
      const keypair = StellarSdk.Keypair.random();
      const publicKey = keypair.publicKey();
      const secret = keypair.secret();

      // Store them in local storage. The secret will only be used when authenticatePasskey succeeds.
      localStorage.setItem(`passkey_secret_${publicKey}`, secret);
      localStorage.setItem(`passkey_credential_${publicKey}`, credentialId);

      setStatusText('Funding with XLM bot...');
      
      // 3. Auto-funding via Friendbot
      try {
        const response = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
        const responseJSON = await response.json();
        if (!response.ok) {
          throw new Error(responseJSON.detail || 'Friendbot failed');
        }
      } catch (fundErr: any) {
        // Friendbot sometimes rate limits or fails, we will still connect
        console.warn('Friendbot funding warning:', fundErr);
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
    trackEvent('Connect Wallet Clicked', { method: 'freighter' });

    try {
      // Import dynamically to avoid SSR issues if any
      const freighter = await import('@stellar/freighter-api');
      
      const { isConnected } = await freighter.isConnected();
      if (!isConnected) {
        throw new Error('Freighter extension not installed or not connected.');
      }

      // Check network (optional, but good practice)
      const networkDetails = await freighter.getNetworkDetails();
      if (networkDetails.network !== 'TESTNET') {
        alert('Please switch Freighter to Testnet');
      }

      const { address, error } = await freighter.requestAccess();
      
      if (error || !address) {
        throw new Error(error || 'User cancelled or no address returned');
      }

      onConnect(address, 'freighter');
      trackEvent('Wallet Connected', { method: 'freighter', address });
    } catch (err: any) {
      setError(err.message || 'Freighter connection failed');
      captureError(err, { context: 'Freighter Connect' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="glass-card" style={{ maxWidth: '400px', margin: '0 auto', textAlign: 'center' }}>
      <h2 className="heading-3" style={{ marginBottom: 'var(--space-2)' }}>Welcome to Stellar Circles</h2>
      <p className="text-muted" style={{ marginBottom: 'var(--space-6)' }}>
        Join a decentralized savings group and build your on-chain reputation.
      </p>

      {error && (
        <div style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-4)', padding: 'var(--space-2)', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 'var(--border-radius-sm)' }}>
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="animate-pulse" style={{ padding: 'var(--space-8) 0' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid var(--color-primary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto var(--space-4)' }} />
          <p className="text-gradient" style={{ fontWeight: 600 }}>{statusText || 'Connecting...'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <button 
            className="btn btn-primary" 
            onClick={handlePasskeyConnect}
            style={{ width: '100%', padding: 'var(--space-3)' }}
          >
            Continue with Passkey <br/>
            <span style={{ fontSize: 'var(--text-xs)', opacity: 0.8, fontWeight: 400 }}>(Recommended • No seed phrase)</span>
          </button>
          
          <div style={{ display: 'flex', alignItems: 'center', margin: 'var(--space-2) 0' }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--glass-border)' }} />
            <span style={{ padding: '0 var(--space-3)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>OR</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--glass-border)' }} />
          </div>

          <button 
            className="btn btn-secondary" 
            onClick={handleFreighterConnect}
            style={{ width: '100%' }}
          >
            Connect Freighter
          </button>
        </div>
      )}

      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};
