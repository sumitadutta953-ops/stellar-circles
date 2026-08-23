import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { trackEvent, captureError } from '../services/analytics';
import { db, type CircleMetadata } from '../services/db';
import '../styles/index.css';

export const CircleDashboard: React.FC<{ walletAddress: string; onTransactionComplete?: () => void }> = ({ walletAddress, onTransactionComplete }) => {
  const navigate = useNavigate();
  const [circles, setCircles] = useState<CircleMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeCircle, setActiveCircle] = useState<CircleMetadata | null>(null);
  const [isContributing, setIsContributing] = useState(false);
  const [isTriggeringPayout, setIsTriggeringPayout] = useState(false);
  const [isLeavingCircle, setIsLeavingCircle] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setRefreshTrigger(r => r + 1), 60000);
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

  /* ─── Contribute ─── */
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
      const tx = new TransactionBuilder(account, { fee: '15000', networkPassphrase: Networks.TESTNET })
        .addOperation(contract.call('contribute', nativeToScVal(BigInt(activeCircle.id), { type: 'u64' }), new Address(walletAddress).toScVal()))
        .setTimeout(300).build();
      const preparedTx = await server.prepareTransaction(tx);
      const { txHash: submittedHash } = await submitTransaction(preparedTx, walletAddress);
      onTransactionComplete?.();
      const currentCycle = activeCircle.currentCycle || 1;
      const existingContributors = activeCircle.contributions?.[currentCycle] || [];
      const newContributors = [...existingContributors, walletAddress];
      const updatedContributions = { ...activeCircle.contributions, [currentCycle]: newContributors };
      await db.updateCircle(activeCircle.id, { contributions: updatedContributions });
      let updatedCircle = { ...activeCircle, contributions: updatedContributions };
      setActiveCircle(updatedCircle);
      setCircles(prev => prev.map(c => c.id === updatedCircle.id ? updatedCircle : c));
      setTxHash(submittedHash);
      trackEvent('Contribution Successful', { circleId: activeCircle.id, txHash: submittedHash });
      const totalMembers = Object.keys(activeCircle.memberProfiles || {}).length;
      if (newContributors.length >= totalMembers) {
        setIsTriggeringPayout(true);
        try {
          const payoutContractId = import.meta.env.VITE_PAYOUT_ID;
          if (!payoutContractId) throw new Error('Payout Contract ID missing');
          const freshAccount = await getAccount(walletAddress);
          const payoutContract = new Contract(payoutContractId);
          const payoutTx = new TransactionBuilder(freshAccount, { fee: '15000', networkPassphrase: Networks.TESTNET })
            .addOperation(payoutContract.call('trigger_payout', nativeToScVal(BigInt(activeCircle.id), { type: 'u64' })))
            .setTimeout(300).build();
          const preparedPayoutTx = await server.prepareTransaction(payoutTx);
          const { txHash: payoutHash } = await submitTransaction(preparedPayoutTx, walletAddress);
          onTransactionComplete?.();
          trackEvent('Payout Auto-Triggered', { circleId: activeCircle.id, cycle: currentCycle, txHash: payoutHash });
          const nextCycle = currentCycle + 1;
          const isCircleComplete = nextCycle > totalMembers;
          const cycleUpdate = isCircleComplete ? { currentCycle: nextCycle, status: 'completed' as const } : { currentCycle: nextCycle };
          await db.updateCircle(activeCircle.id, cycleUpdate);
          updatedCircle = { ...updatedCircle, ...cycleUpdate };
          setActiveCircle(updatedCircle);
          setCircles(prev => prev.map(c => c.id === updatedCircle.id ? updatedCircle : c));
          setTxHash(payoutHash);
          alert(isCircleComplete ? '🎉 All cycles complete! The circle has finished.' : `✅ Cycle #${currentCycle} complete! Payout sent. Cycle #${nextCycle} has begun.`);
        } catch (payoutErr: any) {
          captureError(payoutErr, { context: 'Auto Trigger Payout' });
          alert('Contribution saved ✅ but auto-payout failed: ' + (payoutErr.message || payoutErr));
        } finally { setIsTriggeringPayout(false); }
      }
    } catch (err: any) {
      captureError(err, { context: 'Contribution' });
      alert('Failed to contribute: ' + (err.message || err));
    } finally { setIsContributing(false); }
  };

  /* ─── Leave ─── */
  const handleLeaveCircle = async () => {
    if (!activeCircle) return;
    const remainingCount = Object.keys(activeCircle.memberProfiles || {}).length;
    const isLastMember = remainingCount <= 1;
    const currentCycle = activeCircle.currentCycle || 0;
    const alreadyPaidThisCycle = currentCycle > 0 && (activeCircle.contributions?.[currentCycle]?.includes(walletAddress) ?? false);
    const confirmMsg = isLastMember
      ? `You are the last member. Leaving will permanently delete this circle${alreadyPaidThisCycle ? ' and refund your ' + activeCircle.contributionAmount + ' XLM' : ''}. Are you sure?`
      : `Leave "${activeCircle.name}"?${alreadyPaidThisCycle ? ` Your ${activeCircle.contributionAmount} XLM for Cycle #${currentCycle} will be refunded.` : ''}`;
    if (!window.confirm(confirmMsg)) return;
    setIsLeavingCircle(true);
    try {
      const { Contract, Address, nativeToScVal, Networks, TransactionBuilder } = await import('@stellar/stellar-sdk');
      const { submitTransaction, server, getAccount } = await import('../services/stellar');
      const contributionContractId = import.meta.env.VITE_CONTRIBUTION_ID;
      if (!contributionContractId) throw new Error('Contribution Contract ID missing');
      const contract = new Contract(contributionContractId);
      const account = await getAccount(walletAddress);
      const tx = new TransactionBuilder(account, { fee: '15000', networkPassphrase: Networks.TESTNET })
        .addOperation(contract.call('leave_circle', nativeToScVal(BigInt(activeCircle.id), { type: 'u64' }), new Address(walletAddress).toScVal()))
        .setTimeout(300).build();
      const preparedTx = await server.prepareTransaction(tx);
      await submitTransaction(preparedTx, walletAddress);
      onTransactionComplete?.();
      if (isLastMember) {
        await db.deleteCircle(activeCircle.id);
        trackEvent('Circle Deleted (Last Member Left)', { circleId: activeCircle.id });
        alert(alreadyPaidThisCycle ? `✅ Left and ${activeCircle.contributionAmount} XLM refunded. Circle deleted.` : '✅ You were the last member. Circle deleted.');
      } else {
        await db.removeMemberFromCircle(activeCircle.id, walletAddress);
        trackEvent('Circle Left', { circleId: activeCircle.id });
        alert(alreadyPaidThisCycle ? `✅ Left "${activeCircle.name}" and ${activeCircle.contributionAmount} XLM refunded.` : `✅ Left "${activeCircle.name}".`);
      }
      const updatedCircles = circles.filter(c => c.id !== activeCircle.id);
      setCircles(updatedCircles);
      setActiveCircle(updatedCircles.length > 0 ? updatedCircles[0] : null);
    } catch (err: any) {
      captureError(err, { context: 'Leave Circle' });
      alert('Failed to leave: ' + (err.message || err));
    } finally { setIsLeavingCircle(false); }
  };

  /* ─── Loading ─── */
  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 80 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--c-surface-3)', borderTopColor: 'var(--c-primary)', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ color: 'var(--c-text-muted)', fontSize: 'var(--text-sm)' }}>Loading your circles…</p>
      </div>
    );
  }

  /* ─── Empty state ─── */
  if (circles.length === 0) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 64, paddingBottom: 64 }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>◎</div>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginBottom: 8 }}>No circles yet</h2>
        <p style={{ color: 'var(--c-text-sub)', marginBottom: 32, maxWidth: 300, margin: '0 auto 32px' }}>
          Create a rotating savings group or join one with an invite code.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" style={{ padding: '12px 24px' }} onClick={() => navigate('/create')}>＋ Create Circle</button>
          <button className="btn btn-secondary" style={{ padding: '12px 24px' }} onClick={() => navigate('/join')}>↗ Join with Code</button>
        </div>
      </div>
    );
  }

  const visibleCircles = circles.filter(c => c.status !== 'deleted');

  /* ─────────────────────────────────────────────
     ACTIVE CIRCLE DETAIL PANEL
  ───────────────────────────────────────────── */
  const ActiveCirclePanel = () => {
    if (!activeCircle) return (
      <div className="glass-card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--c-text-muted)' }}>
        Select a circle to view details.
      </div>
    );

    const currentCycle = activeCircle.currentCycle || 0;
    const sortedMembers = Object.values(activeCircle.memberProfiles || {})
      .sort((a, b) => new Date(a.joinedAt || 0).getTime() - new Date(b.joinedAt || 0).getTime());
    const totalMembers = sortedMembers.length;
    const paidCount = activeCircle.contributions?.[currentCycle]?.length || 0;
    const alreadyPaid = (activeCircle.contributions?.[currentCycle] ?? []).includes(walletAddress);
    const paidPct = totalMembers > 0 ? (paidCount / totalMembers) * 100 : 0;
    const poolAmount = Number(activeCircle.contributionAmount || 0) * totalMembers;
    const recipient = currentCycle > 0 ? sortedMembers[currentCycle - 1] : null;
    const isCompleted = activeCircle.status === 'completed';
    const isWaiting = currentCycle === 0;

    return (
      <div className="glass-card animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

        {/* ── Circle header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {activeCircle.name}
              </h2>
              {isCompleted
                ? <span className="badge badge-success">✓ Completed</span>
                : isWaiting
                  ? <span className="badge badge-muted">⏳ Waiting</span>
                  : <span className="badge badge-primary">● Cycle {currentCycle}/{totalMembers}</span>
              }
            </div>
            {activeCircle.description && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--c-text-sub)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                {activeCircle.description}
              </p>
            )}
            {activeCircle.organizer === walletAddress && activeCircle.inviteCode && (
              <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--c-primary-dim)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 'var(--border-radius-full)', padding: '3px 10px' }}>
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--c-text-muted)' }}>Invite</span>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#818CF8', letterSpacing: '0.06em' }}>{activeCircle.inviteCode}</span>
              </div>
            )}
          </div>

          {/* Leave / delete button */}
          {isCompleted ? (
            <button className="btn btn-danger-soft" style={{ fontSize: 'var(--text-xs)', padding: '6px 12px', flexShrink: 0 }}
              disabled={isLeavingCircle}
              onClick={async () => {
                if (window.confirm('Delete this completed circle?')) {
                  setIsLeavingCircle(true);
                  try { await db.deleteCircle(activeCircle.id); setActiveCircle(null); setCircles(circles.filter(c => c.id !== activeCircle.id)); }
                  catch (e: any) { alert('Failed: ' + e.message); }
                  finally { setIsLeavingCircle(false); }
                }
              }}>
              {isLeavingCircle ? '…' : '🗑 Delete'}
            </button>
          ) : (
            <button className="btn btn-danger-soft" style={{ fontSize: 'var(--text-xs)', padding: '6px 12px', flexShrink: 0 }}
              disabled={isLeavingCircle} onClick={handleLeaveCircle}>
              {isLeavingCircle ? '…' : totalMembers <= 1 ? '🗑 Leave & Delete' : '🚪 Leave'}
            </button>
          )}
        </div>

        {/* ── Pool hero ── */}
        {!isWaiting && !isCompleted && (
          <div className="pool-hero" style={{ borderRadius: 'var(--border-radius-lg)', background: 'var(--c-surface-2)', border: '1px solid var(--c-border-subtle)', padding: 'var(--space-5)' }}>
            <div className="pool-hero-label">Total Pool · Cycle {currentCycle}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6 }}>
              <span className="pool-hero-amount">{poolAmount}</span>
              <span className="pool-hero-unit">XLM</span>
            </div>
            {recipient && (
              <div style={{ marginTop: 10, fontSize: 'var(--text-sm)', color: 'var(--c-text-sub)' }}>
                👑 Recipient: <strong style={{ color: 'var(--c-warning)', fontWeight: 600 }}>{recipient.name || 'Unknown'}</strong>
              </div>
            )}
          </div>
        )}

        {/* ── Stats grid ── */}
        {!isWaiting && !isCompleted && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div className="stat-card">
              <div className="stat-label">Contributed</div>
              <div className="stat-value">{paidCount}<span style={{ fontSize: 'var(--text-sm)', color: 'var(--c-text-sub)', fontWeight: 400 }}>/{totalMembers}</span></div>
              <div className="progress-track" style={{ marginTop: 10 }}>
                <div className="progress-fill" style={{ width: `${paidPct}%` }} />
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Per member</div>
              <div className="stat-value">{activeCircle.contributionAmount}<span style={{ fontSize: 'var(--text-sm)', color: 'var(--c-text-sub)', fontWeight: 400 }}> XLM</span></div>
            </div>
          </div>
        )}

        {/* ── Completed state ── */}
        {isCompleted && (
          <div style={{ textAlign: 'center', padding: 'var(--space-6)', background: 'var(--c-success-dim)', border: '1px solid rgba(16,185,129,0.18)', borderRadius: 'var(--border-radius-lg)' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
            <h3 style={{ color: 'var(--c-success)', fontWeight: 700, marginBottom: 4 }}>Circle Completed!</h3>
            <p style={{ color: 'var(--c-text-sub)', fontSize: 'var(--text-sm)' }}>All members have received their payouts.</p>
          </div>
        )}

        {/* ── Waiting state ── */}
        {isWaiting && (
          <div style={{ textAlign: 'center', padding: 'var(--space-5)', background: 'var(--c-surface-2)', borderRadius: 'var(--border-radius-lg)', border: '1px solid var(--c-border-subtle)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
            <p style={{ color: 'var(--c-text-sub)', fontSize: 'var(--text-sm)' }}>
              Waiting for members to join ({totalMembers}/{activeCircle.memberCap})
            </p>
          </div>
        )}

        {/* ── Member list ── */}
        {!isWaiting && !isCompleted && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600 }}>Members</h3>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)', background: 'var(--c-surface-2)', padding: '2px 8px', borderRadius: 'var(--border-radius-full)', border: '1px solid var(--c-border-subtle)' }}>
                {totalMembers} members
              </span>
            </div>
            <div style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border-subtle)', borderRadius: 'var(--border-radius-lg)', padding: '0 var(--space-4)' }}>
              {sortedMembers.map((member, index) => {
                const hasPaid = (activeCircle.contributions?.[currentCycle] ?? []).includes(member.address!);
                const isMe = member.address === walletAddress;
                const isRecipient = index === currentCycle - 1;
                const avatarCls = isRecipient ? 'avatar-recipient' : hasPaid ? 'avatar-paid' : (isMe ? 'avatar-you' : 'avatar-pending');
                return (
                  <div key={index} className="member-row">
                    <div className={`avatar avatar-sm ${avatarCls}`}>
                      {(member.name || 'M').charAt(0).toUpperCase()}
                    </div>
                    <div className="member-info">
                      <div className="member-name">
                        <span>{member.name || `${member.address!.slice(0, 6)}…`}</span>
                        {isMe && <span className="badge badge-primary">You</span>}
                        {isRecipient && <span className="badge badge-warning">👑 Recipient</span>}
                      </div>
                    </div>
                    <div className="member-status">
                      {hasPaid
                        ? <span className="badge badge-success">✓ {activeCircle.contributionAmount} XLM</span>
                        : <span style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)' }}>Pending</span>
                      }
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Tx success banner ── */}
        {txHash && (
          <div className="tx-banner">
            <span style={{ color: 'var(--c-success)', fontWeight: 600 }}>✓ Transaction confirmed</span>
            <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" rel="noreferrer"
              style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-sub)', textDecoration: 'underline' }}>
              View on explorer ↗
            </a>
          </div>
        )}

        {/* ── Contribute button ── */}
        {!isCompleted && !isWaiting && (() => {
          const waitingForOthers = alreadyPaid && paidCount < totalMembers;
          const btnLabel = isTriggeringPayout
            ? '💸 Sending payout on-chain…'
            : isContributing
              ? 'Submitting transaction…'
              : waitingForOthers
                ? `⏳ Waiting for others (${paidCount}/${totalMembers})`
                : alreadyPaid
                  ? '✓ Contributed this cycle'
                  : `Contribute ${activeCircle.contributionAmount} XLM`;
          return (
            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '14px', fontSize: 'var(--text-base)', fontWeight: 700, borderRadius: 'var(--border-radius-lg)', opacity: (alreadyPaid || isTriggeringPayout) ? 0.6 : 1 }}
              onClick={handleContribute}
              disabled={isContributing || isTriggeringPayout || alreadyPaid}
            >
              {btnLabel}
            </button>
          );
        })()}
      </div>
    );
  };

  return (
    <div>
      {/* ── Mobile: horizontal circle chip selector ── */}
      <div className="circle-chips-mobile" style={{ marginBottom: 'var(--space-4)', display: 'none' }}>
        {visibleCircles.map(circle => (
          <button key={circle.id} className={`circle-chip${activeCircle?.id === circle.id ? ' active' : ''}`}
            onClick={() => { setActiveCircle(circle); setTxHash(null); }}>
            {circle.name}
          </button>
        ))}
        <button className="circle-chip" onClick={() => setRefreshTrigger(r => r + 1)} title="Refresh">⟳</button>
      </div>

      {/* ── Dashboard grid: sidebar + detail ── */}
      <div className="dashboard-grid">

        {/* ── LEFT: Sidebar (desktop only) ── */}
        <aside className="sidebar-desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--c-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              My Circles
            </h2>
            <button className="btn btn-ghost" style={{ padding: 6, fontSize: 14 }}
              onClick={() => setRefreshTrigger(r => r + 1)} title="Refresh">⟳</button>
          </div>

          {visibleCircles.map(circle => {
            const isActive = activeCircle?.id === circle.id;
            const cycleText = circle.currentCycle === 0 ? 'Waiting' : circle.status === 'completed' ? 'Completed' : `Cycle ${circle.currentCycle}`;
            const memberCount = Object.keys(circle.memberProfiles || {}).length;
            return (
              <div key={circle.id}
                onClick={() => { setActiveCircle(circle); setTxHash(null); }}
                style={{
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--border-radius-lg)',
                  border: `1px solid ${isActive ? 'rgba(99,102,241,0.4)' : 'var(--c-border)'}`,
                  background: isActive ? 'var(--c-primary-dim)' : 'var(--c-surface)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: isActive ? '#818CF8' : 'var(--c-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {circle.name}
                  </span>
                  {circle.status === 'completed' && <span className="badge badge-success" style={{ marginLeft: 6, flexShrink: 0 }}>✓</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)' }}>{cycleText}</span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--c-border-strong)' }}>·</span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--c-text-muted)' }}>{memberCount}/{circle.memberCap} members</span>
                </div>
                {circle.organizer === walletAddress && circle.inviteCode && (
                  <div style={{ marginTop: 8, fontSize: 'var(--text-xs)', color: isActive ? '#818CF8' : 'var(--c-text-muted)' }}>
                    Code: <strong>{circle.inviteCode}</strong>
                  </div>
                )}
              </div>
            );
          })}

          {/* Desktop nav actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => navigate('/create')}>＋ New Circle</button>
            <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => navigate('/join')}>↗ Join with Code</button>
          </div>
        </aside>

        {/* ── RIGHT: Active circle detail ── */}
        <div>
          <ActiveCirclePanel />
        </div>
      </div>
    </div>
  );
};
