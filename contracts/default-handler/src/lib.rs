#![no_std]
use soroban_sdk::IntoVal;

use soroban_sdk::{Address, Env, Symbol, contract, contractimpl, contracttype};

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

const GRACE_PERIOD_SECONDS: u64 = 86400; // 1 day

#[contract]
pub struct DefaultHandlerContract;

#[contractimpl]
impl DefaultHandlerContract {
    pub fn init(env: Env, factory: Address, contribution_contract: Address) {
        env.storage().instance().set(&DataKey::Factory, &factory);
        env.storage()
            .instance()
            .set(&DataKey::ContributionContract, &contribution_contract);
    }

    pub fn flag_default(env: Env, circle_id: u64, defaulting_member: Address) {
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

        // We can't directly read CycleStart from here without exposing it. Let's assume the contribution contract has it.
        // Wait, we need `get_cycle_start` on the contribution contract.
        let cycle_start: u64 = env.invoke_contract(
            &contribution,
            &Symbol::new(&env, "get_cycle_start"),
            (circle_id,).into_val(&env),
        );

        let now = env.ledger().timestamp();
        assert!(
            now > cycle_start + config.cycle_length_seconds + GRACE_PERIOD_SECONDS,
            "Grace period not yet over"
        );

        let has_contributed: bool = env.invoke_contract(
            &contribution,
            &Symbol::new(&env, "has_contributed"),
            (circle_id, current_cycle, defaulting_member.clone()).into_val(&env),
        );
        assert!(!has_contributed, "Member already contributed");

        // Kick member
        env.invoke_contract::<()>(
            &contribution,
            &Symbol::new(&env, "kick_member"),
            (circle_id, defaulting_member).into_val(&env),
        );
    }
}
