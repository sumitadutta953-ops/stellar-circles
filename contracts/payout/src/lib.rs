#![no_std]
use soroban_sdk::IntoVal;

use soroban_sdk::{Address, Env, Symbol, Vec, contract, contractimpl, contracttype};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircleConfig {
    pub organizer: Address,
    pub contribution_amount: i128,
    pub cycle_length_seconds: u64,
    pub member_cap: u32,
    pub asset: Address,
    pub is_active: bool,
}

#[contracttype]
pub enum DataKey {
    Factory,
    ContributionContract,
}

#[contract]
pub struct PayoutContract;

#[contractimpl]
impl PayoutContract {
    pub fn init(env: Env, factory: Address, contribution_contract: Address) {
        env.storage().instance().set(&DataKey::Factory, &factory);
        env.storage()
            .instance()
            .set(&DataKey::ContributionContract, &contribution_contract);
    }

    pub fn trigger_payout(env: Env, circle_id: u64) {
        let factory: Address = env.storage().instance().get(&DataKey::Factory).unwrap();
        let contribution: Address = env
            .storage()
            .instance()
            .get(&DataKey::ContributionContract)
            .unwrap();

        let config: CircleConfig = env.invoke_contract(
            &factory,
            &Symbol::new(&env, "get_circle_info"),
            (circle_id,).into_val(&env),
        );

        let current_cycle: u32 = env.invoke_contract(
            &contribution,
            &Symbol::new(&env, "get_current_cycle"),
            (circle_id,).into_val(&env),
        );

        let members: Vec<Address> = env.invoke_contract(
            &contribution,
            &Symbol::new(&env, "get_members"),
            (circle_id,).into_val(&env),
        );

        // Verify everyone contributed (this MVP assumes full participation required)
        for member in members.iter() {
            let has_contributed: bool = env.invoke_contract(
                &contribution,
                &Symbol::new(&env, "has_contributed"),
                (circle_id, current_cycle, member.clone()).into_val(&env),
            );
            assert!(has_contributed, "Not all members have contributed");
        }

        // Payout to the member whose index matches the current cycle (1-indexed)
        // For MVP, fixed payout order based on join order
        let recipient_index = current_cycle - 1;
        let recipient = members
            .get(recipient_index)
            .expect("Invalid recipient index");

        let total_payout = config.contribution_amount * (config.member_cap as i128);

        // Transfer funds from Contribution contract to the recipient
        // Wait, the funds are held by the Contribution contract! The Payout contract cannot move them
        // unless it's authorized or the Contribution contract transfers them to Payout contract.
        // Let's invoke the Contribution contract to execute the payout.
        env.invoke_contract::<()>(
            &contribution,
            &Symbol::new(&env, "execute_payout"),
            (circle_id, recipient, total_payout).into_val(&env),
        );
    }
}
