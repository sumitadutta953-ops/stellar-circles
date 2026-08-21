import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { trackEvent, captureError } from '../services/analytics';
import { db } from '../services/db';
import '../styles/index.css';

export const JoinCircle: React.FC<{ walletAddress: string }> = ({ walletAddress }) => {
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
      // Find the circle by invite code
      const allCircles = await db.getAllCircles();
      const circleToJoin = allCircles.find(c => c.inviteCode === inviteCode.toUpperCase());
      
      if (!circleToJoin) {
        throw new Error("Invalid invite code. Circle not found.");
      }

      if (circleToJoin.memberProfiles[walletAddress]) {
        alert("You are already a member of this circle!");
        navigate('/');
        return;
      }

      const { Contract, Address, nativeToScVal } = await import('@stellar/stellar-sdk');
      const { submitTransaction, server, getAccount } = await import('../services/stellar');

      const contributionContractId = import.meta.env.VITE_CONTRIBUTION_ID;
      if (!contributionContractId) throw new Error("Contribution Contract ID missing from environment");

      const contract = new Contract(contributionContractId);
      const account = await getAccount(walletAddress);
      
      const tx = new (await import('@stellar/stellar-sdk')).TransactionBuilder(account, {
        fee: '15000',
        networkPassphrase: (await import('@stellar/stellar-sdk')).Networks.TESTNET
      })
      .addOperation(contract.call("join_circle",
        nativeToScVal(BigInt(circleToJoin.id), { type: 'u64' }),
        new Address(walletAddress).toScVal()
      ))
      .setTimeout(300)
      .build();

      const preparedTx = await server.prepareTransaction(tx);
      const { txHash } = await submitTransaction(preparedTx, walletAddress);

      // Successfully joined on-chain, update Firebase
      const displayName = yourName.trim() || 'Member ' + walletAddress.substring(0, 4);
      const newMemberProfiles = {
        ...circleToJoin.memberProfiles,
        [walletAddress]: {
          address: walletAddress,
          name: displayName,
          joinedAt: new Date().toISOString()
        }
      };
      
      const isFull = Object.keys(newMemberProfiles).length >= (circleToJoin.memberCap || 5);

      await db.updateCircle(circleToJoin.id, {
        memberProfiles: newMemberProfiles,
        ...(isFull && circleToJoin.currentCycle === 0 ? { currentCycle: 1 } : {})
      });

      trackEvent('Circle Joined', { circleId: circleToJoin.id, txHash });
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
    <div className="glass-card animate-fade-in" style={{ maxWidth: '400px', margin: '4rem auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <h2 className="heading-2">Join Circle</h2>
        <button className="btn btn-secondary" onClick={() => navigate('/')}>Back</button>
      </div>
      
      <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
          <label style={{ display: 'block', marginBottom: 'var(--space-1)', color: 'var(--color-text-muted)' }}>Invite Code</label>
          <input 
            type="text" 
            required 
            className="input-field" 
            placeholder="e.g. A1B2C3"
            value={inviteCode}
            onChange={e => setInviteCode(e.target.value.toUpperCase())}
          />
        </div>

        <button 
          type="submit" 
          className="btn btn-primary" 
          disabled={isSubmitting}
          style={{ padding: 'var(--space-3)' }}
        >
          {isSubmitting ? 'Joining on Testnet...' : 'Join Circle'}
        </button>
      </form>
    </div>
  );
};
