import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { trackEvent, captureError } from '../services/analytics';
import { db, type CircleMetadata } from '../services/db';
import '../styles/index.css';

export const CircleDashboard: React.FC<{ walletAddress: string }> = ({ walletAddress }) => {
  const navigate = useNavigate();
  const [circles, setCircles] = useState<CircleMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeCircle, setActiveCircle] = useState<CircleMetadata | null>(null);
  const [isContributing, setIsContributing] = useState(false);
  const [isTriggeringPayout, setIsTriggeringPayout] = useState(false);
  const [isLeavingCircle, setIsLeavingCircle] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Auto-reload every 60 seconds to ensure synchronization
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTrigger(r => r + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = db.subscribeToCircles(walletAddress, (myCircles) => {
      setCircles(myCircles);
      
      setActiveCircle(currentActive => {
        if (!currentActive && myCircles.length > 0) return myCircles[0];
        if (currentActive) {
          const updated = myCircles.find(c => c.id === currentActive.id);
          return updated || (myCircles.length > 0 ? myCircles[0] : null);
        }
        return null;
      });
      
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [walletAddress, refreshTrigger]);

  const handleContribute = async () => {
    if (!activeCircle) return;
    setIsContributing(true);
    trackEvent('Contribution Initiated', { circleId: activeCircle.id });

    try {
      const { Contract, Address, nativeToScVal, Networks, TransactionBuilder } = await import('@stellar/stellar-sdk');
      const { submitTransaction, server, getAccount } = await import('../services/stellar');

      const contributionContractId = import.meta.env.VITE_CONTRIBUTION_ID;
      if (!contributionContractId) throw new Error('Contribution Contract ID missing');

      const contract = new Contract(contributionContractId);
      const account = await getAccount(walletAddress);

      const tx = new TransactionBuilder(account, {
        fee: '15000',
        networkPassphrase: Networks.TESTNET
      })
        .addOperation(contract.call('contribute',
          nativeToScVal(BigInt(activeCircle.id), { type: 'u64' }),
          new Address(walletAddress).toScVal()
        ))
        .setTimeout(300)
        .build();

      const preparedTx = await server.prepareTransaction(tx);
      const { txHash: submittedHash } = await submitTransaction(preparedTx, walletAddress);

      // --- Update Firebase contributions ---
      const currentCycle = activeCircle.currentCycle || 1;
      const existingContributors = activeCircle.contributions?.[currentCycle] || [];
      const newContributors = [...existingContributors, walletAddress];
      const updatedContributions = {
        ...activeCircle.contributions,
        [currentCycle]: newContributors
      };
      await db.updateCircle(activeCircle.id, { contributions: updatedContributions });

      // Update local state immediately so ledger flips Pending → Paid
      let updatedCircle = { ...activeCircle, contributions: updatedContributions };
      setActiveCircle(updatedCircle);
      setCircles(prev => prev.map(c => c.id === updatedCircle.id ? updatedCircle : c));
      setTxHash(submittedHash);
      trackEvent('Contribution Successful', { circleId: activeCircle.id, txHash: submittedHash });

      // --- Auto-trigger payout when ALL members have now contributed ---
      const totalMembers = Object.keys(activeCircle.memberProfiles || {}).length;
      const isLastContributor = newContributors.length >= totalMembers;

      if (isLastContributor) {
        setIsTriggeringPayout(true);
        try {
          const payoutContractId = import.meta.env.VITE_PAYOUT_ID;
          if (!payoutContractId) throw new Error('Payout Contract ID missing');

          // Need a fresh account sequence for the second tx
          const freshAccount = await getAccount(walletAddress);
          const payoutContract = new Contract(payoutContractId);
          const payoutTx = new TransactionBuilder(freshAccount, {
            fee: '15000',
            networkPassphrase: Networks.TESTNET
          })
            .addOperation(payoutContract.call('trigger_payout',
              nativeToScVal(BigInt(activeCircle.id), { type: 'u64' })
            ))
            .setTimeout(300)
            .build();

          const preparedPayoutTx = await server.prepareTransaction(payoutTx);
          const { txHash: payoutHash } = await submitTransaction(preparedPayoutTx, walletAddress);
          trackEvent('Payout Auto-Triggered', { circleId: activeCircle.id, cycle: currentCycle, txHash: payoutHash });

          // Advance cycle in Firebase
          const nextCycle = currentCycle + 1;
          const isCircleComplete = nextCycle > totalMembers;
          const cycleUpdate = isCircleComplete
            ? { currentCycle: nextCycle, status: 'completed' as const }
            : { currentCycle: nextCycle };
          await db.updateCircle(activeCircle.id, cycleUpdate);

          // Advance local state
          updatedCircle = { ...updatedCircle, ...cycleUpdate };
          setActiveCircle(updatedCircle);
          setCircles(prev => prev.map(c => c.id === updatedCircle.id ? updatedCircle : c));
          setTxHash(payoutHash);

          alert(isCircleComplete
            ? '🎉 All cycles complete! The circle has finished.'
            : `✅ Cycle #${currentCycle} complete! Payout sent. Cycle #${nextCycle} has begun.`);
        } catch (payoutErr: any) {
          captureError(payoutErr, { context: 'Auto Trigger Payout' });
          alert('Contribution saved ✅ but auto-payout failed: ' + (payoutErr.message || payoutErr) + '\nPlease contact support.');
        } finally {
          setIsTriggeringPayout(false);
        }
      }
    } catch (err: any) {
      captureError(err, { context: 'Contribution' });
      alert('Failed to contribute: ' + (err.message || err));
    } finally {
      setIsContributing(false);
    }
  };


  const handleLeaveCircle = async () => {
    if (!activeCircle) return;

    const remainingCount = Object.keys(activeCircle.memberProfiles || {}).length;
    const isLastMember = remainingCount <= 1;
    const currentCycle = activeCircle.currentCycle || 0;
    const alreadyPaidThisCycle = currentCycle > 0 &&
      (activeCircle.contributions?.[currentCycle]?.includes(walletAddress) ?? false);

    const confirmMsg = isLastMember
      ? `You are the last member. Leaving will permanently delete this circle${alreadyPaidThisCycle ? ' and refund your ' + activeCircle.contributionAmount + ' XLM deposit' : ''}. Are you sure?`
      : `Are you sure you want to leave "${activeCircle.name}"?${alreadyPaidThisCycle ? ` Your ${activeCircle.contributionAmount} XLM contribution for Cycle #${currentCycle} will be refunded on-chain.` : ''}`;

    if (!window.confirm(confirmMsg)) return;
    setIsLeavingCircle(true);

    try {
      // ── On-chain: call leave_circle (handles XLM refund atomically) ──
      const { Contract, Address, nativeToScVal, Networks, TransactionBuilder } = await import('@stellar/stellar-sdk');
      const { submitTransaction, server, getAccount } = await import('../services/stellar');

      const contributionContractId = import.meta.env.VITE_CONTRIBUTION_ID;
      if (!contributionContractId) throw new Error('Contribution Contract ID missing');

      const contract = new Contract(contributionContractId);
      const account = await getAccount(walletAddress);

      const tx = new TransactionBuilder(account, {
        fee: '15000',
        networkPassphrase: Networks.TESTNET
      })
        .addOperation(contract.call('leave_circle',
          nativeToScVal(BigInt(activeCircle.id), { type: 'u64' }),
          new Address(walletAddress).toScVal()
        ))
        .setTimeout(300)
        .build();

      const preparedTx = await server.prepareTransaction(tx);
      await submitTransaction(preparedTx, walletAddress);

      // ── Off-chain: update Firebase ──
      if (isLastMember) {
        await db.deleteCircle(activeCircle.id);
        trackEvent('Circle Deleted (Last Member Left)', { circleId: activeCircle.id });
        alert(
          alreadyPaidThisCycle
            ? `✅ You left and your ${activeCircle.contributionAmount} XLM was refunded. Circle deleted.`
            : '✅ You were the last member. The circle has been permanently deleted.'
        );
      } else {
        await db.removeMemberFromCircle(activeCircle.id, walletAddress);
        trackEvent('Circle Left', { circleId: activeCircle.id });
        alert(
          alreadyPaidThisCycle
            ? `✅ You left "${activeCircle.name}" and your ${activeCircle.contributionAmount} XLM was refunded on-chain.`
            : `✅ You have left "${activeCircle.name}".`
        );
      }

      // Remove from local state
      const updatedCircles = circles.filter(c => c.id !== activeCircle.id);
      setCircles(updatedCircles);
      setActiveCircle(updatedCircles.length > 0 ? updatedCircles[0] : null);
    } catch (err: any) {
      captureError(err, { context: 'Leave Circle' });
      alert('Failed to leave circle: ' + (err.message || err));
    } finally {
      setIsLeavingCircle(false);
    }
  };



  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-8)' }}>
        <div className="animate-pulse" style={{ width: '40px', height: '40px', border: '3px solid var(--color-primary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2.5fr', gap: 'var(--space-8)' }}>
      {/* Sidebar: Circle List */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h2 className="heading-3">My Circles</h2>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button 
              className="btn btn-secondary" 
              style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
              onClick={() => setRefreshTrigger(r => r + 1)}
              title="Force Refresh Data"
            >
              🔄
            </button>
            <button className="btn btn-secondary" style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-sm)' }} onClick={() => navigate('/join')}>
              Join
            </button>
            <button className="btn btn-primary" style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-sm)' }} onClick={() => navigate('/create')}>
              + New
            </button>
          </div>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {circles.length === 0 ? (
            <p className="text-muted">You haven't joined any circles yet.</p>
          ) : (
            circles.filter(c => c.status !== 'deleted').map(circle => (
              <div 
                key={circle.id} 
                className="glass-card" 
                style={{ 
                  cursor: 'pointer', 
                  padding: 'var(--space-3)', 
                  borderColor: activeCircle?.id === circle.id ? 'var(--color-primary)' : 'var(--glass-border)',
                  boxShadow: activeCircle?.id === circle.id ? 'var(--shadow-glow)' : 'none'
                }}
                onClick={() => setActiveCircle(circle)}
              >
                <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>{circle.name}</h3>
                <p className="text-muted" style={{ fontSize: 'var(--text-sm)', margin: '4px 0' }}>ID: {circle.id}</p>
                {circle.inviteCode && circle.organizer === walletAddress && (
                  <div style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', display: 'inline-block', fontSize: 'var(--text-xs)' }}>
                    Code: <strong style={{ color: 'var(--color-primary-hover)' }}>{circle.inviteCode}</strong>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Content: Active Circle Dashboard */}
      <div>
        {activeCircle ? (
          <div className="glass-card animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 className="heading-2">{activeCircle.name}</h2>
                <p className="text-muted">{activeCircle.description}</p>
              </div>
              {activeCircle.status === 'completed' ? (
                <button
                  className="btn btn-secondary"
                  style={{
                    color: '#ef4444',
                    borderColor: 'rgba(239, 68, 68, 0.3)',
                    padding: 'var(--space-1) var(--space-3)',
                    fontSize: 'var(--text-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)'
                  }}
                  onClick={async () => {
                    if (window.confirm('Are you sure you want to delete this completed circle? It will be removed for all members.')) {
                      setIsLeavingCircle(true);
                      try {
                        await db.deleteCircle(activeCircle.id);
                        setActiveCircle(null);
                        setCircles(circles.filter(c => c.id !== activeCircle.id));
                      } catch (err: any) {
                        captureError(err, { context: 'Delete Completed Circle' });
                        alert('Failed to delete: ' + err.message);
                      } finally {
                        setIsLeavingCircle(false);
                      }
                    }
                  }}
                  disabled={isLeavingCircle}
                >
                  {isLeavingCircle ? 'Deleting…' : '🗑️ Delete Completed Circle'}
                </button>
              ) : (
                <button
                  className="btn btn-secondary"
                  style={{
                    color: '#ef4444',
                    borderColor: 'rgba(239, 68, 68, 0.3)',
                    padding: 'var(--space-1) var(--space-3)',
                    fontSize: 'var(--text-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)'
                  }}
                  onClick={handleLeaveCircle}
                  disabled={isLeavingCircle}
                >
                  {isLeavingCircle
                    ? 'Leaving…'
                    : Object.keys(activeCircle.memberProfiles || {}).length <= 1
                      ? '🗑 Leave & Delete'
                      : '🚪 Leave Circle'
                  }
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
              <div className="glass-card" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <h4 className="text-muted" style={{ marginBottom: 'var(--space-2)' }}>Current Cycle</h4>
                <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, color: 'var(--color-accent)' }}>
                  #{activeCircle.currentCycle || 0}
                </div>
              </div>
              <div className="glass-card" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <h4 className="text-muted" style={{ marginBottom: 'var(--space-2)' }}>Status</h4>
                <div style={{ 
                  fontSize: 'var(--text-xl)', 
                  fontWeight: 600, 
                  color: activeCircle.status === 'completed' ? '#10b981' : 'var(--color-text)' 
                }}>
                  {activeCircle.status === 'completed' ? '🎉 Completed' : (activeCircle.currentCycle === 0 ? 'Waiting for members' : 'Active')}
                </div>
              </div>
            </div>

            {activeCircle.status === 'completed' ? (
              <div className="glass-card" style={{ textAlign: 'center', background: 'rgba(16, 185, 129, 0.05)', borderColor: 'rgba(16, 185, 129, 0.2)' }}>
                <h3 style={{ color: '#10b981', marginBottom: 'var(--space-2)' }}>Circle Successfully Completed!</h3>
                <p className="text-muted" style={{ margin: 0 }}>All members have received their payouts. No further contributions are needed.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
                {(() => {
                  const currentCycle = activeCircle.currentCycle || 1;
                  const alreadyPaid = activeCircle.contributions?.[currentCycle]?.includes(walletAddress) ?? false;
                  const paidCount = activeCircle.contributions?.[currentCycle]?.length || 0;
                  const totalMembers = Object.keys(activeCircle.memberProfiles || {}).length;
                  const waitingForOthers = alreadyPaid && paidCount < totalMembers;
                  const isProcessingPayout = isTriggeringPayout;
                  return (
                    <button
                      className="btn btn-primary"
                      style={{
                        flex: 1,
                        padding: 'var(--space-3)',
                        opacity: (alreadyPaid || isProcessingPayout) ? 0.6 : 1,
                        cursor: (alreadyPaid || isProcessingPayout) ? 'not-allowed' : 'pointer'
                      }}
                      onClick={handleContribute}
                      disabled={isContributing || isProcessingPayout || activeCircle.currentCycle === 0 || alreadyPaid}
                    >
                      {isProcessingPayout
                        ? '💸 Sending payout on-chain…'
                        : isContributing
                          ? 'Submitting via Freighter…'
                          : waitingForOthers
                            ? `⏳ Waiting for others… (${paidCount}/${totalMembers})`
                            : alreadyPaid
                              ? '✅ Already Contributed'
                              : `Contribute ${activeCircle.contributionAmount || '100'} XLM`}
                    </button>
                  );
                })()}
              </div>
            )}

            {txHash && (
              <div style={{ padding: 'var(--space-3)', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--color-accent)', borderRadius: 'var(--border-radius-sm)', marginTop: 'var(--space-2)' }}>
                <p style={{ margin: 0, color: 'var(--color-accent)' }}>
                  ✅ Transaction Successful!
                </p>
                <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ fontSize: 'var(--text-sm)' }}>
                  View on Stellar Expert ↗
                </a>
              </div>
            )}
            
            {/* Level-by-Level Contribution Ledger */}
            <div style={{ marginTop: 'var(--space-4)' }}>
              <h3 className="heading-3" style={{ marginBottom: 'var(--space-4)' }}>Member Contributions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {activeCircle.currentCycle === 0 ? (
                  <div className="glass-card" style={{ background: 'rgba(0,0,0,0.2)', textAlign: 'center' }}>
                    <p className="text-muted">Circle has not started. Waiting for the circle to fill up!</p>
                  </div>
                ) : activeCircle.status === 'completed' ? (
                  <div className="glass-card" style={{ background: 'rgba(0,0,0,0.2)', textAlign: 'center' }}>
                    <p className="text-muted">Circle is finished! No more contributions required.</p>
                  </div>
                ) : (
                  <div className="glass-card" style={{ background: 'rgba(0,0,0,0.2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                      <div>
                        <h4 style={{ color: 'var(--color-primary-hover)', margin: 0, marginBottom: '4px' }}>Cycle #{activeCircle.currentCycle}</h4>
                        {(() => {
                          const sorted = Object.values(activeCircle.memberProfiles || {}).sort((a, b) => new Date(a.joinedAt || 0).getTime() - new Date(b.joinedAt || 0).getTime());
                          const recipient = sorted[activeCircle.currentCycle - 1];
                          const totalPool = Number(activeCircle.contributionAmount || 0) * sorted.length;
                          return recipient ? (
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                              Total pool of <strong style={{ color: '#f59e0b' }}>{totalPool} XLM</strong> goes to <strong style={{ color: 'var(--color-text)' }}>{recipient.name || 'this member'}</strong>
                            </div>
                          ) : null;
                        })()}
                      </div>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                        {activeCircle.contributions?.[activeCircle.currentCycle]?.length || 0} / {Object.keys(activeCircle.memberProfiles || {}).length} contributed
                      </span>
                    </div>
                    {(() => {
                      const sortedMembers = Object.values(activeCircle.memberProfiles || {}).sort((a, b) => new Date(a.joinedAt || 0).getTime() - new Date(b.joinedAt || 0).getTime());
                      return sortedMembers.map((member, index) => {
                        const hasPaid = activeCircle.contributions?.[activeCircle.currentCycle]?.includes(member.address!);
                        const isMe = member.address === walletAddress;
                        const isRecipient = index === activeCircle.currentCycle - 1;
                        return (
                          <div key={index} style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: 'var(--space-3) var(--space-2)',
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            background: hasPaid ? 'rgba(16,185,129,0.04)' : 'transparent',
                            borderRadius: index === 0 ? 'var(--border-radius-sm) var(--border-radius-sm) 0 0' : '0'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                              <div style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                background: hasPaid ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.08)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 'var(--text-sm)',
                                fontWeight: 700,
                                color: hasPaid ? '#10b981' : 'var(--color-text-muted)'
                              }}>
                                {(member.name || 'M').charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <span style={{ fontWeight: 600 }}>{member.name || `${member.address!.substring(0,6)}...`}</span>
                                {isMe && (
                                  <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--text-xs)', background: 'rgba(139,92,246,0.2)', color: 'var(--color-primary-hover)', padding: '1px 6px', borderRadius: '99px' }}>You</span>
                                )}
                                {isRecipient && (
                                  <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--text-xs)', background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', padding: '2px 8px', borderRadius: '99px', fontWeight: 600 }}>👑 Payout Recipient</span>
                                )}
                              </div>
                            </div>
                            <span>
                              {hasPaid ? (
                                <span style={{ color: '#10b981', fontWeight: 600 }}>✅ {activeCircle.contributionAmount} XLM paid</span>
                              ) : (
                                <span style={{ color: 'var(--color-text-muted)' }}>⏳ Pending</span>
                              )}
                            </span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="glass-card" style={{ textAlign: 'center', padding: 'var(--space-12)' }}>
            <p className="text-muted">Select a circle to view details.</p>
          </div>
        )}
      </div>
    </div>
  );
};
