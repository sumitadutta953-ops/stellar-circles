/**
 * stellar.ts
 * ──────────────────────────────────────────────────────────────────────────
 * Core Stellar / Soroban integration layer for Stellar Circles.
 *
 * Public API:
 *   CONTRACT_IDS       – Named map of every deployed Soroban contract address.
 *   buildContractCall  – Builds + simulates a Soroban transaction ready to sign.
 *   submitTransaction  – Signs (Passkey or Freighter) and submits to Testnet.
 *   getAccount         – Fetches the current on-chain account / sequence number.
 *   getNativeBalance   – Returns native XLM balance via Horizon REST API.
 *   server             – Shared Soroban RPC server instance (rpc.Server).
 * ──────────────────────────────────────────────────────────────────────────
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import { signTransaction } from '@stellar/freighter-api';

// ── Network configuration ──────────────────────────────────────────────────
const RPC_URL = 'https://soroban-testnet.stellar.org';
export const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

/** Soroban RPC server — used for prepareTransaction, sendTransaction, getTransaction */
export const server = new StellarSdk.rpc.Server(RPC_URL);

// ── Deployed Contract IDs (Stellar Testnet) ────────────────────────────────
/**
 * CONTRACT_IDS maps human-readable contract names to their on-chain C-addresses
 * (Stellar contract IDs on Testnet). Values are injected at build time by Vite
 * from environment variables defined in frontend/.env.
 *
 * Contract function reference:
 *   circleFactory  → init | create_circle | get_circle_info | set_inactive
 *   contribution   → init | join_circle | contribute | has_contributed
 *                    get_current_cycle | get_members | get_cycle_start
 *                    execute_payout | kick_member | delete_circle | leave_circle
 *   payout         → init | trigger_payout
 *   passkeyFactory → init | deploy_wallet
 *   reputation     → init | record_contribution | get_score
 *   defaultHandler → init | handle_default
 */
export const CONTRACT_IDS = {
  /** CircleFactory: create_circle(organizer, asset, amount, cycle_secs, cap) → u64 */
  circleFactory:  import.meta.env.VITE_CIRCLE_FACTORY_ID   as string,
  /** Contribution: join_circle, contribute, leave_circle, execute_payout, get_members */
  contribution:   import.meta.env.VITE_CONTRIBUTION_ID     as string,
  /** Payout: trigger_payout(circle_id) — verifies all paid, sends pool to recipient */
  payout:         import.meta.env.VITE_PAYOUT_ID           as string,
  /** PasskeyFactory: deploy_wallet(wallet_wasm_hash, public_key) → Address */
  passkeyFactory: import.meta.env.VITE_PASSKEY_FACTORY_ID  as string,
  /** Reputation: record_contribution(member) | get_score(member) → u32 */
  reputation:     import.meta.env.VITE_REPUTATION_ID       as string,
  /** DefaultHandler: handle_default(circle_id, member) */
  defaultHandler: import.meta.env.VITE_DEFAULT_HANDLER_ID  as string,
} as const;

// ── buildContractCall ──────────────────────────────────────────────────────

/**
 * Builds and simulates a Soroban contract invocation transaction.
 *
 * This function encapsulates the full @stellar/stellar-sdk flow:
 *   1. new Contract(contractId)
 *   2. new TransactionBuilder(account, { fee, networkPassphrase })
 *      .addOperation(contract.call(functionName, ...args))
 *   3. server.prepareTransaction(tx)   ← Soroban RPC simulation + footprint
 *
 * The returned Transaction is ready to be passed directly to submitTransaction().
 *
 * @param contractId      - C-address of the deployed Soroban contract (from CONTRACT_IDS)
 * @param functionName    - Exact name of the contract function (matches #[contractimpl] in lib.rs)
 * @param args            - ScVal arguments in the same order as the Rust function signature
 * @param sourcePublicKey - Stellar G-address of the transaction fee source / signer
 * @returns               A prepared Transaction (footprint + auth populated)
 *
 * @example — create a savings circle
 *   const tx = await buildContractCall(
 *     CONTRACT_IDS.circleFactory,
 *     'create_circle',
 *     [
 *       new StellarSdk.Address(walletAddress).toScVal(),
 *       new StellarSdk.Address(XLM_CONTRACT_ID).toScVal(),
 *       StellarSdk.nativeToScVal(500_000_000n, { type: 'i128' }), // 50 XLM in stroops
 *       StellarSdk.nativeToScVal(604800,        { type: 'u64'  }), // 7 days in seconds
 *       StellarSdk.nativeToScVal(5,             { type: 'u32'  }), // member cap
 *     ],
 *     walletAddress
 *   );
 *   const { txHash, returnValue: circleId } = await submitTransaction(tx, walletAddress);
 *
 * @example — join a circle
 *   const tx = await buildContractCall(
 *     CONTRACT_IDS.contribution,
 *     'join_circle',
 *     [
 *       StellarSdk.nativeToScVal(BigInt(circleId), { type: 'u64' }),
 *       new StellarSdk.Address(walletAddress).toScVal(),
 *     ],
 *     walletAddress
 *   );
 *   await submitTransaction(tx, walletAddress);
 *
 * @example — make a contribution (triggers token.transfer internally)
 *   const tx = await buildContractCall(
 *     CONTRACT_IDS.contribution,
 *     'contribute',
 *     [
 *       StellarSdk.nativeToScVal(BigInt(circleId), { type: 'u64' }),
 *       new StellarSdk.Address(walletAddress).toScVal(),
 *     ],
 *     walletAddress
 *   );
 *   await submitTransaction(tx, walletAddress);
 *
 * @example — trigger payout (called when all members have contributed)
 *   const tx = await buildContractCall(
 *     CONTRACT_IDS.payout,
 *     'trigger_payout',
 *     [ StellarSdk.nativeToScVal(BigInt(circleId), { type: 'u64' }) ],
 *     walletAddress
 *   );
 *   await submitTransaction(tx, walletAddress);
 */
export async function buildContractCall(
  contractId: string,
  functionName: string,
  args: StellarSdk.xdr.ScVal[],
  sourcePublicKey: string,
): Promise<StellarSdk.Transaction> {
  if (!contractId) {
    throw new Error(
      `Contract ID is undefined for "${functionName}". ` +
      'Ensure VITE_* env vars are set in frontend/.env'
    );
  }

  const contract = new StellarSdk.Contract(contractId);
  const account  = await getAccount(sourcePublicKey);

  const rawTx = new StellarSdk.TransactionBuilder(account, {
    fee: '15000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(300)
    .build();

  // server.prepareTransaction runs a Soroban RPC simulation:
  // - calculates resource fees
  // - sets the transaction footprint (ledger keys read/write)
  // - populates Soroban authorization entries
  return server.prepareTransaction(rawTx) as Promise<StellarSdk.Transaction>;
}

// ── submitTransaction ──────────────────────────────────────────────────────

/**
 * Signs a prepared Soroban transaction and submits it to Testnet.
 *
 * Signing strategy:
 *   - If a passkey_secret is found in localStorage → Passkey flow:
 *       WebAuthn biometric prompt → Ed25519 keypair → authorizeEntry per auth entry
 *   - Otherwise → Freighter browser extension flow
 *
 * After submission, polls getTransaction() until SUCCESS, FAILED, or timeout.
 */
export async function submitTransaction(
  tx: StellarSdk.Transaction,
  signerPublicKey: string
): Promise<{ txHash: string; returnValue: any }> {
  let signedTx: StellarSdk.Transaction;

  const localSecret  = localStorage.getItem(`passkey_secret_${signerPublicKey}`);
  const credentialId = localStorage.getItem(`passkey_credential_${signerPublicKey}`);

  if (localSecret && credentialId) {
    // ── Passkey path ────────────────────────────────────────────────────
    // 1. Require biometric authentication before the secret is used
    const { authenticatePasskey } = await import('./passkey');
    await authenticatePasskey(credentialId);

    const keypair = StellarSdk.Keypair.fromSecret(localSecret);

    // 2. Sign all Soroban auth entries (includes inner token.transfer auth)
    const { sequence } = await server.getLatestLedger();
    const validUntil   = sequence + 500; // ~40 minutes

    const innerTx    = tx.tx;
    const operations = innerTx.operations();
    let authModified = false;

    for (let i = 0; i < operations.length; i++) {
      const body = operations[i].body();
      if (body.switch().name === 'invokeHostFunction') {
        const op   = body.invokeHostFunctionOp();
        const auth = op.auth();
        if (auth && auth.length > 0) {
          const newAuth = [];
          for (let j = 0; j < auth.length; j++) {
            const signedEntry = await StellarSdk.authorizeEntry(
              auth[j], keypair, validUntil, NETWORK_PASSPHRASE
            );
            newAuth.push(signedEntry);
          }
          op.auth(newAuth);
          authModified = true;
        }
      }
    }

    if (authModified) {
      const env = StellarSdk.xdr.TransactionEnvelope.envelopeTypeTx(
        new StellarSdk.xdr.TransactionV1Envelope({
          tx: innerTx as any,
          signatures: [],
        })
      );
      tx = new StellarSdk.Transaction(env.toXDR('base64'), NETWORK_PASSPHRASE);
    }

    tx.sign(keypair);
    signedTx = tx;

  } else {
    // ── Freighter path ──────────────────────────────────────────────────
    const { signedTxXdr, error } = await signTransaction(tx.toXDR(), {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: signerPublicKey,
    });

    if (error || !signedTxXdr) {
      throw new Error(error || 'Failed to sign transaction with Freighter');
    }

    signedTx = StellarSdk.TransactionBuilder.fromXDR(
      signedTxXdr,
      NETWORK_PASSPHRASE
    ) as StellarSdk.Transaction;
  }

  // ── Submit ────────────────────────────────────────────────────────────
  const sendResponse = await server.sendTransaction(signedTx);

  if (sendResponse.status === 'ERROR') {
    throw new Error(
      `Transaction failed: ${
        (sendResponse as any).errorResultXdr ||
        JSON.stringify((sendResponse as any).errorResult) ||
        sendResponse.hash
      }`
    );
  }

  // ── Poll for finality ─────────────────────────────────────────────────
  let statusResult = await server.getTransaction(sendResponse.hash);
  let retries = 0;
  while (statusResult.status === 'NOT_FOUND' && retries < 20) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    statusResult = await server.getTransaction(sendResponse.hash);
    retries++;
  }

  if (statusResult.status === 'SUCCESS') {
    const parsedValue = statusResult.returnValue
      ? StellarSdk.scValToNative(statusResult.returnValue)
      : null;
    return { txHash: statusResult.txHash, returnValue: parsedValue };
  } else if (statusResult.status === 'FAILED') {
    throw new Error(`Transaction failed on-chain: ${statusResult.txHash}`);
  } else {
    throw new Error(`Transaction timed out or status unknown: ${statusResult.status}`);
  }
}

// ── getAccount ─────────────────────────────────────────────────────────────

/**
 * Fetches the current account state and sequence number from Soroban RPC.
 * Must be called immediately before building each transaction to avoid
 * sequence number conflicts on multi-tx flows.
 */
export async function getAccount(publicKey: string): Promise<StellarSdk.Account> {
  const accountInfo = await server.getAccount(publicKey);
  return new StellarSdk.Account(publicKey, accountInfo.sequenceNumber());
}

// ── getNativeBalance ───────────────────────────────────────────────────────

/** Returns the native XLM balance for the given public key via Horizon REST. */
export async function getNativeBalance(publicKey: string): Promise<string> {
  try {
    const horizon = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');
    const account = await horizon.loadAccount(publicKey);
    const nativeBalance = account.balances.find(b => b.asset_type === 'native');
    return nativeBalance ? nativeBalance.balance : '0';
  } catch (_e) {
    return '0';
  }
}
