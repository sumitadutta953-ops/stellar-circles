#![no_std]
use soroban_sdk::IntoVal;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec,
};

// We redefine CircleConfig here or import it if they were in a shared crate.
// For simplicity we redefine it so we can parse the return value of get_circle_info.
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
    // (circle_id, cycle, member) -> bool (has contributed)
    Contribution(u64, u32, Address),
    // (circle_id) -> Vec<Address> (members joined)
    Members(u64),
    // (circle_id) -> u32 (current cycle, 1-indexed)
    CurrentCycle(u64),
    // (circle_id) -> u64 (timestamp of cycle start)
    CycleStart(u64),
}

#[contract]
pub struct ContributionContract;

#[contractimpl]
impl ContributionContract {
    pub fn init(env: Env, factory: Address) {
        env.storage().instance().set(&DataKey::Factory, &factory);
    }

    pub fn join_circle(env: Env, circle_id: u64, member: Address) {
        member.require_auth();

        let factory: Address = env.storage().instance().get(&DataKey::Factory).unwrap();
        // Invoke factory to check if circle exists and get member_cap
        let config: CircleConfig = env.invoke_contract(
            &factory,
            &Symbol::new(&env, "get_circle_info"),
            (circle_id,).into_val(&env),
        );
        
        assert!(config.is_active, "Circle is not active");

        let mut members: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Members(circle_id))
            .unwrap_or_else(|| Vec::new(&env));

        assert!(members.len() < config.member_cap, "Circle is full");
        assert!(!members.contains(&member), "Already a member");

        members.push_back(member);
        env.storage().persistent().set(&DataKey::Members(circle_id), &members);

        // If circle is now full, start Cycle 1
        if members.len() == config.member_cap {
            env.storage().persistent().set(&DataKey::CurrentCycle(circle_id), &1u32);
            env.storage().persistent().set(&DataKey::CycleStart(circle_id), &env.ledger().timestamp());
        }
    }

    pub fn contribute(env: Env, circle_id: u64, member: Address) {
        member.require_auth();

        let current_cycle: u32 = env.storage().persistent().get(&DataKey::CurrentCycle(circle_id)).expect("Circle not started");
        assert!(current_cycle > 0, "Circle not started");

        let factory: Address = env.storage().instance().get(&DataKey::Factory).unwrap();
        let config: CircleConfig = env.invoke_contract(
            &factory,
            &Symbol::new(&env, "get_circle_info"),
            (circle_id,).into_val(&env),
        );

        let cycle_start: u64 = env.storage().persistent().get(&DataKey::CycleStart(circle_id)).unwrap();
        let now = env.ledger().timestamp();
        assert!(now <= cycle_start + config.cycle_length_seconds, "Cycle deadline missed");

        // Verify member is in circle
        let members: Vec<Address> = env.storage().persistent().get(&DataKey::Members(circle_id)).unwrap();
        assert!(members.contains(&member), "Not a member");

        // Mark as contributed
        let contribution_key = DataKey::Contribution(circle_id, current_cycle, member.clone());
        let already_contributed: bool = env.storage().persistent().get(&contribution_key).unwrap_or(false);
        assert!(!already_contributed, "Already contributed this cycle");

        // Transfer funds from member to this contract
        use soroban_sdk::token;
        let token_client = token::Client::new(&env, &config.asset);
        token_client.transfer(&member, &env.current_contract_address(), &config.contribution_amount);

        env.storage().persistent().set(&contribution_key, &true);
    }

    pub fn get_current_cycle(env: Env, circle_id: u64) -> u32 {
        env.storage().persistent().get(&DataKey::CurrentCycle(circle_id)).unwrap_or(0)
    }

    pub fn get_members(env: Env, circle_id: u64) -> Vec<Address> {
        env.storage().persistent().get(&DataKey::Members(circle_id)).unwrap_or_else(|| Vec::new(&env))
    }

    pub fn has_contributed(env: Env, circle_id: u64, cycle: u32, member: Address) -> bool {
        env.storage().persistent().get(&DataKey::Contribution(circle_id, cycle, member)).unwrap_or(false)
    }

    pub fn execute_payout(env: Env, circle_id: u64, recipient: Address, amount: i128) {
        // In a real scenario, we should verify that the caller is the Payout contract.
        // For the MVP, we assume the caller is authorized if they know the contract ID,
        // or we can explicitly store the Payout contract address and verify it.
        let factory: Address = env.storage().instance().get(&DataKey::Factory).unwrap();
        let config: CircleConfig = env.invoke_contract(
            &factory,
            &Symbol::new(&env, "get_circle_info"),
            (circle_id,).into_val(&env),
        );

        use soroban_sdk::token;
        let token_client = token::Client::new(&env, &config.asset);
        token_client.transfer(&env.current_contract_address(), &recipient, &amount);

        // Advance to next cycle
        let current_cycle: u32 = env.storage().persistent().get(&DataKey::CurrentCycle(circle_id)).unwrap();
        if current_cycle < config.member_cap {
            env.storage().persistent().set(&DataKey::CurrentCycle(circle_id), &(current_cycle + 1));
            env.storage().persistent().set(&DataKey::CycleStart(circle_id), &env.ledger().timestamp());
        }
    }

    pub fn get_cycle_start(env: Env, circle_id: u64) -> u64 {
        env.storage().persistent().get(&DataKey::CycleStart(circle_id)).unwrap_or(0)
    }

    pub fn kick_member(env: Env, circle_id: u64, member: Address) {
        // Assume caller authorization is verified (e.g. called by DefaultHandler)
        let mut members: Vec<Address> = env.storage().persistent().get(&DataKey::Members(circle_id)).unwrap();
        if let Some(index) = members.iter().position(|m| m == member) {
            members.remove(index as u32);
            env.storage().persistent().set(&DataKey::Members(circle_id), &members);
        }
    }

    pub fn delete_circle(env: Env, circle_id: u64, caller: Address) {
        caller.require_auth();

        let factory: Address = env.storage().instance().get(&DataKey::Factory).unwrap();
        
        let config: CircleConfig = env.invoke_contract(
            &factory,
            &Symbol::new(&env, "get_circle_info"),
            (circle_id,).into_val(&env),
        );

        assert!(caller == config.organizer, "Only the organizer can delete the circle");
        assert!(config.is_active, "Circle is already deleted");

        // Deactivate via factory
        env.invoke_contract::<()>(
            &factory,
            &Symbol::new(&env, "set_inactive"),
            (circle_id, caller.clone()).into_val(&env),
        );

        // Refund equally
        let members: Vec<Address> = env.storage().persistent().get(&DataKey::Members(circle_id)).unwrap_or_else(|| Vec::new(&env));
        if members.len() > 0 {
            use soroban_sdk::token;
            let token_client = token::Client::new(&env, &config.asset);
            
            // Check balance of this contract
            let balance = token_client.balance(&env.current_contract_address());
            
            if balance > 0 {
                // Distribute equally
                let amount_per_member = balance / (members.len() as i128);
                
                if amount_per_member > 0 {
                    for member in members.iter() {
                        token_client.transfer(&env.current_contract_address(), &member, &amount_per_member);
                    }
                }
            }
        }
    }

    /// Any member can call this to leave a circle.
    /// - Refunds their contribution for the current active cycle (if they already paid).
    /// - If they are the last remaining member, the full vault balance is returned to them.
    /// - Removes them from the on-chain members list.
    pub fn leave_circle(env: Env, circle_id: u64, member: Address) {
        member.require_auth();

        let factory: Address = env.storage().instance().get(&DataKey::Factory).unwrap();
        let config: CircleConfig = env.invoke_contract(
            &factory,
            &Symbol::new(&env, "get_circle_info"),
            (circle_id,).into_val(&env),
        );

        assert!(config.is_active, "Circle is not active");

        let mut members: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Members(circle_id))
            .unwrap_or_else(|| Vec::new(&env));

        assert!(members.contains(&member), "Not a member of this circle");

        use soroban_sdk::token;
        let token_client = token::Client::new(&env, &config.asset);
        let vault_balance = token_client.balance(&env.current_contract_address());

        if members.len() == 1 {
            // Last member leaving — return the entire remaining vault to them
            if vault_balance > 0 {
                token_client.transfer(
                    &env.current_contract_address(),
                    &member,
                    &vault_balance,
                );
            }
        } else {
            // Refund only their current-cycle contribution if they already paid it
            let current_cycle: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::CurrentCycle(circle_id))
                .unwrap_or(0);

            if current_cycle > 0 {
                let contribution_key =
                    DataKey::Contribution(circle_id, current_cycle, member.clone());
                let has_contributed: bool = env
                    .storage()
                    .persistent()
                    .get(&contribution_key)
                    .unwrap_or(false);

                if has_contributed && vault_balance >= config.contribution_amount {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &member,
                        &config.contribution_amount,
                    );
                    // Clear their contribution record so the cycle count stays accurate
                    env.storage().persistent().remove(&contribution_key);
                }
            }
        }

        // Remove from the members list
        if let Some(index) = members.iter().position(|m| m == member) {
            members.remove(index as u32);
            env.storage()
                .persistent()
                .set(&DataKey::Members(circle_id), &members);
        }
    }
}


