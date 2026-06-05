#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, BytesN, Env,
};

/// Stable, client-readable contract errors.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidAmount = 3,
    ExpiredVoucher = 4,
    NonceReplayed = 5,
    InsufficientBalance = 6,
}

/// Typed storage keys for all contract state.
///
/// Instance storage:
/// - `Admin`: privileged account allowed to upgrade the contract.
/// - `Treasury`: protocol toll recipient.
/// - `Token`: official accepted asset contract.
///
/// Persistent storage:
/// - `Vault(Address)`: user locked balance.
/// - `Nonce(BytesN<32>)`: replay protection for settled vouchers.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Treasury,
    Token,
    Vault(Address),
    Nonce(BytesN<32>),
}

/// Pijin P2P data-free transport contract foundation.
#[contract]
pub struct PijinContract;

#[contractimpl]
impl PijinContract {
    /// Protocol 22 constructor.
    ///
    /// Constructor execution is expected only once, but the guard keeps tests and
    /// any future compatibility path from silently overwriting privileged state.
    pub fn __constructor(env: Env, admin: Address, treasury: Address, token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, ContractError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::Token, &token);
    }

    /// Upgrade the current contract WASM.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), ContractError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::Unauthorized)?;

        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);

        Ok(())
    }
}

#[cfg(test)]
mod test;