import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { trackEvent, captureError } from '../services/analytics';
import { db } from '../services/db';
import '../styles/index.css';

export const JoinCircle: React.FC<{ walletAddress: string; onTransactionComplete?: () => void }> = ({ walletAddress, onTransactionComplete }) => {
  const navigate = useNavigate();
  const [inviteCode, setInviteCode] = useState('');
  const [yourName, setYourName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode) return;
    setIsSubmitting(true);
    trackEvent('Join Circle Initiated', { inviteCode });
    try {
      const allCircles = await db.getAllCircles();
      const circleToJoin = allCircles.find(c => c.inviteCode === inviteCode.toUpperCase());
      if (!circleToJoin) throw new Error('Invalid invite code. Circle not found.');
      if (circleToJoin.memberProfiles[walletAddress]) {
        alert('You are already a member of this circle!');
        navigate('/');
        return;
      }
      const { Contract, Address, nativeToScVal } = await import('@stellar/stellar-sdk');
      const { submitTransaction, server, getAccount } = await import('../services/stellar');
      const contributionContractId = import.meta.env.VITE_CONTRIBUTION_ID;
      if (!contributionContractId) throw new Error('Contribution Contract ID missing from environment');
      const contract = new Contract(contributionContractId);
      const account = await getAccount(walletAddress);
      const tx = new (await import('@stellar/stellar-sdk')).TransactionBuilder(account, {
        fee: '15000',
        networkPassphrase: (await import('@stellar/stellar-sdk')).Networks.TESTNET
      })
        .addOperation(contract.call('join_circle',
          nativeToScVal(BigInt(circleToJoin.id), { type: 'u64' }),
          new Address(walletAddress).toScVal()
        ))
        .setTimeout(300).build();
      const preparedTx = await server.prepareTransaction(tx);
      const { txHash } = await submitTransaction(preparedTx, walletAddress);
      const displayName = yourName.trim() || 'Member ' + walletAddress.substring(0, 4);
      const newMemberProfiles = {
        ...circleToJoin.memberProfiles,
        [walletAddress]: { address: walletAddress, name: displayName, joinedAt: new Date().toISOString() }
      };
      const isFull = Object.keys(newMemberProfiles).length >= (circleToJoin.memberCap || 5);
      await db.updateCircle(circleToJoin.id, {
        memberProfiles: newMemberProfiles,
        ...(isFull && circleToJoin.currentCycle === 0 ? { currentCycle: 1 } : {})
      });
      trackEvent('Circle Joined', { circleId: circleToJoin.id, txHash });
      onTransactionComplete?.();
      alert(`Successfully joined ${circleToJoin.name}!\nTx Hash: ${txHash}`);
      navigate('/');
    } catch (error: any) {
      captureError(error, { context: 'Join Circle' });
      alert('Failed to join circle: ' + (error.message || error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      {/* Back nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--space-6)' }}>
        <button className="btn btn-ghost" onClick={() => navigate('/')} style={{ padding: '6px 10px', fontSize: 18 }}>←</button>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, lineHeight: 1.2 }}>Join a Circle</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--c-text-sub)', marginTop: 2 }}>
            Enter the invite code shared by the organizer
          </p>
        </div>
      </div>

      <div className="glass-card">
        <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div>
            <label className="label-text">Your Display Name</label>
            <input
              type="text" required className="input-field"
              placeholder="e.g. Sumita, Rahul, Mom…"
              value={yourName} onChange={e => setYourName(e.target.value)}
            />
          </div>

          <div>
            <label className="label-text">Invite Code</label>
            <input
              type="text" required className="input-field"
              placeholder="e.g. A1B2C3"
              value={inviteCode}
              onChange={e => setInviteCode(e.target.value.toUpperCase())}
              style={{
                fontSize: 'var(--text-2xl)',
                fontWeight: 700,
                letterSpacing: '0.2em',
                textAlign: 'center',
                textTransform: 'uppercase',
                padding: 'var(--space-4)',
              }}
              maxLength={8}
            />
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)', marginTop: 6 }}>
              Ask the circle organizer for their invite code
            </p>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting || inviteCode.length < 4}
            style={{ width: '100%', padding: '14px', fontSize: 'var(--text-base)', fontWeight: 700, borderRadius: 'var(--border-radius-lg)' }}
          >
            {isSubmitting ? '⟳ Joining…' : '↗ Join Circle'}
          </button>
        </form>
      </div>

      {/* Info box */}
      <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)', background: 'var(--c-surface-2)', border: '1px solid var(--c-border-subtle)', borderRadius: 'var(--border-radius-lg)' }}>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)', lineHeight: 1.6 }}>
          🔒 Joining a circle is an on-chain transaction. Your membership is recorded permanently on the Stellar Testnet.
        </p>
      </div>
    </div>
  );
};
