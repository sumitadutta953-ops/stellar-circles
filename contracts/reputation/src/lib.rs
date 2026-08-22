#![no_std]
use soroban_sdk::{Address, Env, contract, contractimpl, contracttype, symbol_short};

#[contracttype]
pub enum DataKey {
    Factory,
    // Address -> u32 (Number of completed circles)
    Reputation(Address),
}

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    pub fn init(env: Env, factory: Address) {
        env.storage().instance().set(&DataKey::Factory, &factory);
    }

    pub fn mint_completion_badge(env: Env, member: Address) {
        // In reality, we should verify the caller is the Payout contract or Contribution contract.
        // For MVP, we trust the caller knows the contract address.
        let mut rep: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Reputation(member.clone()))
            .unwrap_or(0);
        rep += 1;
        env.storage()
            .persistent()
            .set(&DataKey::Reputation(member), &rep);
    }

    pub fn get_reputation_score(env: Env, member: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Reputation(member))
            .unwrap_or(0)
    }
}
