#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

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
    Config(u64),      // circle_id -> CircleConfig
    CircleCount,      // u64
    Admin,            // Address
}

#[contract]
pub struct CircleFactory;

#[contractimpl]
impl CircleFactory {
    pub fn init(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::CircleCount, &0u64);
    }

    pub fn create_circle(
        env: Env,
        organizer: Address,
        asset: Address,
        contribution_amount: i128,
        cycle_length_seconds: u64,
        member_cap: u32,
    ) -> u64 {
        organizer.require_auth();

        let mut count: u64 = env.storage().instance().get(&DataKey::CircleCount).unwrap_or(0);
        count += 1;

        let config = CircleConfig {
            organizer,
            contribution_amount,
            cycle_length_seconds,
            member_cap,
            asset,
            is_active: true,
        };

        env.storage().persistent().set(&DataKey::Config(count), &config);
        env.storage().instance().set(&DataKey::CircleCount, &count);

        count
    }

    pub fn get_circle_info(env: Env, circle_id: u64) -> CircleConfig {
        env.storage()
            .persistent()
            .get(&DataKey::Config(circle_id))
            .expect("Circle not found")
    }

    pub fn set_inactive(env: Env, circle_id: u64, caller: Address) {
        caller.require_auth();
        
        let mut config: CircleConfig = env.storage()
            .persistent()
            .get(&DataKey::Config(circle_id))
            .expect("Circle not found");
            
        assert!(caller == config.organizer, "Only the organizer can deactivate the circle");
        assert!(config.is_active, "Circle is already inactive");
        
        config.is_active = false;
        env.storage().persistent().set(&DataKey::Config(circle_id), &config);
    }
}
