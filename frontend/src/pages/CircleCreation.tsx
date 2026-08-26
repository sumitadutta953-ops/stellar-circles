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
      if (!circleFactoryId) throw new Error("Circle Factory ID missing from environment");

      const contract = new Contract(circleFactoryId);
      const account = await getAccount(walletAddress);

      // Native XLM contract on Testnet
      const xlmAsset = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

      const tx = new (await import('@stellar/stellar-sdk')).TransactionBuilder(account, {
        fee: '15000',
        networkPassphrase: (await import('@stellar/stellar-sdk')).Networks.TESTNET
      })
      .addOperation(contract.call("create_circle",
        new Address(walletAddress).toScVal(),
        new Address(xlmAsset).toScVal(),
        nativeToScVal(BigInt(formData.contributionAmount) * 10000000n, { type: 'i128' }), // Convert XLM to stroops
        nativeToScVal(Number(formData.cycleLength) * 24 * 60 * 60, { type: 'u64' }), // Convert days to seconds
        nativeToScVal(Number(formData.memberCap), { type: 'u32' })
      ))
        .setTimeout(300)
      .build();

      const preparedTx = await server.prepareTransaction(tx);
      const { txHash, returnValue } = await submitTransaction(preparedTx, walletAddress);

      if (returnValue === undefined || returnValue === null) {
        throw new Error("Failed to extract Circle ID from Soroban transaction return value.");
      }
      
      const realCircleId = returnValue.toString();
      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      
      const displayName = yourName.trim() || 'Member ' + walletAddress.substring(0, 4);
      const newMemberProfiles = {
        [walletAddress]: {
          address: walletAddress,
          name: displayName,
          joinedAt: new Date().toISOString()
        }
      };
      
      const isFull = 1 >= Number(formData.memberCap);

      // Save off-chain metadata
      await db.createCircle({
        id: realCircleId,
        name: formData.name,
        description: formData.description,
        contributionAmount: formData.contributionAmount,
        memberCap: Number(formData.memberCap),
        currentCycle: isFull ? 1 : 0, // Starts if memberCap is 1 (unlikely but possible)
        status: 'active',
        organizer: walletAddress,
        inviteCode: inviteCode,
        memberProfiles: newMemberProfiles,
        contributions: {}
      });

      trackEvent('Circle Created', { circleId: realCircleId, txHash });
      
      // Auto-join the creator to the contribution contract!
      try {
        const contributionContractId = import.meta.env.VITE_CONTRIBUTION_ID;
        const contribContract = new Contract(contributionContractId);
        
        // Re-fetch account to guarantee we have the exact sequence number after the first tx
        const freshAccount = await getAccount(walletAddress);
        
        const joinTx = new (await import('@stellar/stellar-sdk')).TransactionBuilder(freshAccount, {
          fee: '15000',
          networkPassphrase: (await import('@stellar/stellar-sdk')).Networks.TESTNET
        })
        .addOperation(contribContract.call("join_circle",
          nativeToScVal(BigInt(realCircleId), { type: 'u64' }),
          new Address(walletAddress).toScVal()
        ))
        .setTimeout(300)
        .build();

        const preparedJoinTx = await server.prepareTransaction(joinTx);
        await submitTransaction(preparedJoinTx, walletAddress);
        
        onTransactionComplete?.(); // Refresh wallet balance after deploy
        alert(`Circle deployed successfully and you were auto-joined!\nInvite Code: ${inviteCode}\nTx Hash: ${txHash}`);
      } catch (joinErr: any) {
        captureError(joinErr, { context: 'Auto Join Circle' });
        alert(`Circle was deployed, but auto-join failed. Please join manually using invite code ${inviteCode}. Error: ` + (joinErr.message || joinErr));
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
    <div className="glass-card animate-fade-in" style={{ maxWidth: '600px', margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <h2 className="heading-2 text-gradient">Create a Circle</h2>
        <button className="btn btn-secondary" onClick={() => navigate('/')}>Back</button>
      </div>
      
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ padding: 'var(--space-3)', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 'var(--border-radius-sm)' }}>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>👤 You will join as a <strong style={{ color: 'var(--color-primary-hover)' }}>regular member</strong> — enter your name so others can see you in the circle.</p>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 'var(--space-1)', color: 'var(--color-text-muted)' }}>Your Display Name</label>
          <input
            type="text"
            required
            className="input-field"
            placeholder="e.g. Sumita, Rahul, Mom…"
            value={yourName}
            onChange={e => setYourName(e.target.value)}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 'var(--space-1)', color: 'var(--color-text-muted)' }}>Circle Name</label>
          <input 
            type="text" 
            required 
            className="input-field" 
            placeholder="e.g. Family Savings, Weekly Tanda"
            value={formData.name}
            onChange={e => setFormData({...formData, name: e.target.value})}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 'var(--space-1)', color: 'var(--color-text-muted)' }}>Description (Off-chain)</label>
          <textarea 
            required 
            className="input-field" 
            rows={3}
            placeholder="What is this circle for?"
            value={formData.description}
            onChange={e => setFormData({...formData, description: e.target.value})}
          />
        </div>

        <div className="form-grid-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--space-1)', color: 'var(--color-text-muted)' }}>Contribution per Cycle (XLM)</label>
            <input 
              type="number" 
              required 
              min="1"
              className="input-field" 
              value={formData.contributionAmount}
              onChange={e => setFormData({...formData, contributionAmount: e.target.value})}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--space-1)', color: 'var(--color-text-muted)' }}>Member Cap</label>
            <input 
              type="number" 
              required 
              min="2"
              max="20"
              className="input-field" 
              value={formData.memberCap}
              onChange={e => setFormData({...formData, memberCap: e.target.value})}
            />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 'var(--space-1)', color: 'var(--color-text-muted)' }}>Cycle Length (Days)</label>
          <input 
            type="number" 
            required 
            min="1"
            className="input-field" 
            value={formData.cycleLength}
            onChange={e => setFormData({...formData, cycleLength: e.target.value})}
          />
        </div>

        <button 
          type="submit" 
          className="btn btn-primary" 
          disabled={isSubmitting}
          style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)' }}
        >
          {isSubmitting ? 'Deploying to Testnet...' : 'Deploy Circle Contract'}
        </button>
      </form>
    </div>
  );
};
