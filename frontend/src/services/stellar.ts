import * as StellarSdk from '@stellar/stellar-sdk';
import { signTransaction, signAuthEntry, getPublicKey } from '@stellar/freighter-api';

const rpcUrl = 'https://soroban-testnet.stellar.org';
const networkPassphrase = StellarSdk.Networks.TESTNET;
export const server = new StellarSdk.rpc.Server(rpcUrl);



export async function submitTransaction(
  tx: StellarSdk.Transaction,
  signerPublicKey: string
): Promise<{ txHash: string; returnValue: any }> {
  let signedTx: StellarSdk.Transaction;

  const localSecret = localStorage.getItem(`passkey_secret_${signerPublicKey}`);
  const credentialId = localStorage.getItem(`passkey_credential_${signerPublicKey}`);

  if (localSecret && credentialId) {
    // PASSKEY FLOW
    const { authenticatePasskey } = await import('./passkey');
    // Prompt the user with native WebAuthn to authorize the transaction
    await authenticatePasskey(credentialId);

    // If authentication succeeds, sign the transaction using the stored Keypair
    const keypair = StellarSdk.Keypair.fromSecret(localSecret);
    
    try {
      const { sequence } = await server.getLatestLedger();
      const validUntil = sequence + 500; // valid for 500 ledgers (~40 minutes)
      
      const innerTx = tx.tx; // xdr.Transaction
      const operations = innerTx.operations();
      let authModified = false;
      
      for (let i = 0; i < operations.length; i++) {
         const body = operations[i].body();
         if (body.switch().name === 'invokeHostFunction') {
             const op = body.invokeHostFunctionOp();
             const auth = op.auth();
             if (auth && auth.length > 0) {
                 const newAuth = [];
                 for (let j = 0; j < auth.length; j++) {
                    const signedEntry = await StellarSdk.authorizeEntry(auth[j], keypair, validUntil, networkPassphrase);
                    newAuth.push(signedEntry);
                 }
                 op.auth(newAuth);
                 authModified = true;
             }
         }
      }
      
      if (authModified) {
         // Reconstruct the transaction if auth entries were mutated
         const env = StellarSdk.xdr.TransactionEnvelope.envelopeTypeTx(
           new StellarSdk.xdr.TransactionV1Envelope({
             tx: innerTx,
             signatures: []
           })
         );
         tx = new StellarSdk.Transaction(env.toXDR('base64'), networkPassphrase);
      }
    } catch (authErr) {
      console.warn("Failed to sign inner auth entries:", authErr);
    }

    tx.sign(keypair);
    signedTx = tx;
  } else {
    // FREIGHTER FLOW
    const { signedTxXdr, error } = await signTransaction(tx.toXDR(), {
      networkPassphrase,
      address: signerPublicKey,
    });

    if (error || !signedTxXdr) {
      throw new Error(error || 'Failed to sign transaction with Freighter');
    }

    signedTx = StellarSdk.TransactionBuilder.fromXDR(
      signedTxXdr,
      networkPassphrase
    ) as StellarSdk.Transaction;
  }

  // Step 3: Submit to network
  let sendResponse = await server.sendTransaction(signedTx);

  if (sendResponse.status === 'ERROR') {
    throw new Error(
      `Transaction failed: ${sendResponse.errorResultXdr || JSON.stringify((sendResponse as any).errorResult) || sendResponse.hash}`
    );
  }

  // Step 4: Poll for completion
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

export async function getAccount(publicKey: string): Promise<StellarSdk.Account> {
  const accountInfo = await server.getAccount(publicKey);
  return new StellarSdk.Account(publicKey, accountInfo.sequenceNumber());
}
export async function getNativeBalance(publicKey: string): Promise<string> {
  try {
    const horizon = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');
    const account = await horizon.loadAccount(publicKey);
    const nativeBalance = account.balances.find(b => b.asset_type === 'native');
    return nativeBalance ? nativeBalance.balance : '0';
  } catch (e) {
    return '0';
  }
}
