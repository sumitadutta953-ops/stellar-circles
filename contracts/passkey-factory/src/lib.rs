#![no_std]
use smart_wallet_interface::types::{Signer, SignerExpiration, SignerLimits, SignerStorage};
use soroban_sdk::{
    contract, contractimpl, symbol_short, Address, Bytes, BytesN, Env, IntoVal, Symbol,
};

#[contract]
pub struct PasskeyFactory;

#[contractimpl]
impl PasskeyFactory {
    /// Initialize the factory with the WASM hash of the passkey-wallet contract.
    pub fn init(env: Env, wallet_wasm_hash: BytesN<32>) {
        env.storage()
            .instance()
            .set(&symbol_short!("wasm"), &wallet_wasm_hash);
    }

    /// Deploy a new passkey-wallet for the given secp256r1 public key and credential ID.
    pub fn deploy_wallet(env: Env, public_key: BytesN<65>, credential_id: Bytes) -> Address {
        let wasm_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&symbol_short!("wasm"))
            .expect("WASM hash not initialized");

        // We use the public key as the salt to derive the wallet address
        let salt = env.crypto().sha256(&public_key.clone().into());

        let signer = Signer::Secp256r1(
            credential_id,
            public_key,
            SignerExpiration(None), // no expiration
            SignerLimits(None),     // unlimited admin
            SignerStorage::Persistent,
        );

        // Deploy the wallet, invoking its `__constructor` with the initial signer.
        let deployed_address = env
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, (signer,));

        deployed_address
    }
}
