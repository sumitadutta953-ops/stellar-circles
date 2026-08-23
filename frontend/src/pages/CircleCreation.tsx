import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { trackEvent, captureError } from '../services/analytics';
import { db } from '../services/db';
import '../styles/index.css';

export const CircleCreation: React.FC<{ walletAddress: string; onTransactionComplete?: () => void }> = ({ walletAddress, onTransactionComplete }) => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    contributionAmount: '100',
    cycleLength: '7',
    memberCap: '5'
  });
  const [yourName, setYourName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    trackEvent('Circle Creation Initiated');
    try {
      const { Contract, Address, nativeToScVal } = await import('@stellar/stellar-sdk');
      const { submitTransaction, server, getAccount } = await import('../services/stellar');
      const circleFactoryId = import.meta.env.VITE_CIRCLE_FACTORY_ID;
      if (!circleFactoryId) throw new Error('Circle Factory ID missing from environment');
      const contract = new Contract(circleFactoryId);
      const account = await getAccount(walletAddress);
      const xlmAsset = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
      const tx = new (await import('@stellar/stellar-sdk')).TransactionBuilder(account, {
        fee: '15000',
        networkPassphrase: (await import('@stellar/stellar-sdk')).Networks.TESTNET
      })
        .addOperation(contract.call('create_circle',
          new Address(walletAddress).toScVal(),
          new Address(xlmAsset).toScVal(),
          nativeToScVal(BigInt(formData.contributionAmount) * 10000000n, { type: 'i128' }),
          nativeToScVal(Number(formData.cycleLength) * 24 * 60 * 60, { type: 'u64' }),
          nativeToScVal(Number(formData.memberCap), { type: 'u32' })
        ))
        .setTimeout(300).build();
      const preparedTx = await server.prepareTransaction(tx);
      const { txHash, returnValue } = await submitTransaction(preparedTx, walletAddress);
      if (returnValue === undefined || returnValue === null) throw new Error('Failed to extract Circle ID from transaction.');
      const realCircleId = returnValue.toString();
      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const displayName = yourName.trim() || 'Member ' + walletAddress.substring(0, 4);
      const newMemberProfiles = {
        [walletAddress]: { address: walletAddress, name: displayName, joinedAt: new Date().toISOString() }
      };
      const isFull = 1 >= Number(formData.memberCap);
      await db.createCircle({
        id: realCircleId,
        name: formData.name,
        description: formData.description,
        contributionAmount: formData.contributionAmount,
        memberCap: Number(formData.memberCap),
        currentCycle: isFull ? 1 : 0,
        status: 'active',
        organizer: walletAddress,
        inviteCode,
        memberProfiles: newMemberProfiles,
        contributions: {}
      });
      trackEvent('Circle Created', { circleId: realCircleId, txHash });
      try {
        const contributionContractId = import.meta.env.VITE_CONTRIBUTION_ID;
        const contribContract = new Contract(contributionContractId);
        const freshAccount = await getAccount(walletAddress);
        const joinTx = new (await import('@stellar/stellar-sdk')).TransactionBuilder(freshAccount, {
          fee: '15000',
          networkPassphrase: (await import('@stellar/stellar-sdk')).Networks.TESTNET
        })
          .addOperation(contribContract.call('join_circle',
            nativeToScVal(BigInt(realCircleId), { type: 'u64' }),
            new Address(walletAddress).toScVal()
          ))
          .setTimeout(300).build();
        const preparedJoinTx = await server.prepareTransaction(joinTx);
        await submitTransaction(preparedJoinTx, walletAddress);
        onTransactionComplete?.();
        alert(`Circle deployed successfully!\nInvite Code: ${inviteCode}\nTx Hash: ${txHash}`);
      } catch (joinErr: any) {
        captureError(joinErr, { context: 'Auto Join Circle' });
        alert(`Circle deployed! Auto-join failed — use invite code ${inviteCode} to join manually.\nError: ` + (joinErr.message || joinErr));
      }
      navigate('/');
    } catch (error: any) {
      captureError(error, { context: 'Circle Creation' });
      alert('Failed to deploy circle: ' + (error.message || error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {/* Back nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--space-6)' }}>
        <button className="btn btn-ghost" onClick={() => navigate('/')} style={{ padding: '6px 10px', fontSize: 18 }}>←</button>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, lineHeight: 1.2 }}>Create a Circle</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--c-text-sub)', marginTop: 2 }}>
            Deploy a new savings circle on Stellar Testnet
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

        {/* ── Identity ── */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--space-2)', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--c-border-subtle)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--border-radius-md)', background: 'var(--c-primary-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>👤</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Your Identity</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)' }}>Shown to other circle members</div>
            </div>
          </div>
          <div>
            <label className="label-text">Your Display Name</label>
            <input type="text" required className="input-field"
              placeholder="e.g. Sumita, Rahul, Mom…"
              value={yourName} onChange={e => setYourName(e.target.value)} />
          </div>
        </div>

        {/* ── Circle details ── */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--space-2)', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--c-border-subtle)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--border-radius-md)', background: 'var(--c-primary-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>◎</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Circle Details</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)' }}>Stored off-chain in Firebase</div>
            </div>
          </div>
          <div>
            <label className="label-text">Circle Name</label>
            <input type="text" required className="input-field"
              placeholder="e.g. Family Savings, Weekly Tanda"
              value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
          </div>
          <div>
            <label className="label-text">Description</label>
            <textarea required className="input-field" rows={3}
              placeholder="What is this circle for?"
              value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} />
          </div>
        </div>

        {/* ── On-chain params ── */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--space-2)', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--c-border-subtle)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--border-radius-md)', background: 'var(--c-warning-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>⚙️</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>On-chain Parameters</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)' }}>Deployed to Stellar Testnet · Cannot change after creation</div>
            </div>
          </div>

          {/* 2-col on desktop, 1-col on mobile */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-4)' }}>
            <div>
              <label className="label-text">Contribution per Cycle (XLM)</label>
              <input type="number" required min="1" className="input-field"
                value={formData.contributionAmount} onChange={e => setFormData({ ...formData, contributionAmount: e.target.value })} />
            </div>
            <div>
              <label className="label-text">Member Cap</label>
              <input type="number" required min="2" max="20" className="input-field"
                value={formData.memberCap} onChange={e => setFormData({ ...formData, memberCap: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="label-text">Cycle Length (Days)</label>
            <input type="number" required min="1" className="input-field"
              value={formData.cycleLength} onChange={e => setFormData({ ...formData, cycleLength: e.target.value })} />
          </div>

          {/* Preview card */}
          <div style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border-subtle)', borderRadius: 'var(--border-radius-md)', padding: 'var(--space-4)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)', marginBottom: 2 }}>Total pool per cycle</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--c-success)' }}>
                {(Number(formData.contributionAmount) || 0) * (Number(formData.memberCap) || 0)} XLM
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)', marginBottom: 2 }}>Total duration</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>
                {(Number(formData.memberCap) || 0) * (Number(formData.cycleLength) || 0)} days
              </div>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={isSubmitting}
          style={{ width: '100%', padding: '14px', fontSize: 'var(--text-base)', fontWeight: 700, borderRadius: 'var(--border-radius-lg)' }}
        >
          {isSubmitting ? '⟳ Deploying to Testnet…' : '🚀 Deploy Circle'}
        </button>
      </form>
    </div>
  );
};
