#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    xdr::ToXdr, Address, BytesN, Env,
};

pub const DAY_IN_LEDGERS: u32 = 17_280;
pub const THIRTY_DAYS_IN_LEDGERS: u32 = 518_400;

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
    MathOverflow = 8,
    NotWhitelistedGateway = 9,
}

/// Typed storage keys for all contract state.
///
/// Instance storage:
/// - `Admin`: privileged account allowed to upgrade the contract.
/// - `Treasury`: protocol toll recipient.
///
/// Persistent storage:
/// - `Vault(Address, Address)`: per-user, per-token locked balance.
///   The tuple is `(UserAddress, TokenAddress)`, enabling the Omni-Vault
///   to hold and route any number of Stellar tokens simultaneously.
/// - `Nonce(BytesN<32>)`: replay protection for settled vouchers.
/// - `RegisteredKey(Address)`: user's offline Ed25519 key.
/// - `Gateway(Address)`: whitelisted relayer entry.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Treasury,
    Vault(Address, Address),
    Nonce(BytesN<32>),
    RegisteredKey(Address),
    Gateway(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct DepositEvent {
    pub sender: Address,
    pub token: Address,
    pub amount: i128,
    pub balance: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct SpendEvent {
    pub sender: Address,
    pub gateway: Address,
    pub token: Address,
    pub receiver: Address,
    pub amount: i128,
    pub protocol_toll: i128,
    pub nonce: BytesN<32>,
    pub balance: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct WithdrawEvent {
    pub sender: Address,
    pub token: Address,
    pub amount: i128,
}

/// Pijin P2P data-free transport contract foundation.
#[contract]
pub struct PijinContract;

#[contractimpl]
impl PijinContract {
    /// Protocol 22 constructor.
    ///
    /// Initialises the Omni-Vault with only the `Admin` and `Treasury`
    /// addresses. No token is locked at the contract level — supported assets
    /// are determined dynamically per vault entry (`DataKey::Vault(user, token)`).
    ///
    /// Constructor execution is expected only once, but the guard keeps tests
    /// and any future compatibility path from silently overwriting privileged state.
    pub fn __constructor(env: Env, admin: Address, treasury: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, ContractError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
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

    pub fn deposit(
        env: Env,
        sender: Address,
        token: Address,
        pubkey: BytesN<32>,
        amount: i128,
    ) -> Result<(), ContractError> {
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        sender.require_auth();

        let vault_key = DataKey::Vault(sender.clone(), token.clone());
        let registered_key = DataKey::RegisteredKey(sender.clone());
        let current_balance = get_persistent_i128(&env, &vault_key);
        let new_balance = current_balance
            .checked_add(amount)
            .ok_or(ContractError::MathOverflow)?;

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&sender, &env.current_contract_address(), &amount);

        env.storage().persistent().set(&vault_key, &new_balance);
        env.storage().persistent().set(&registered_key, &pubkey);
        extend_persistent_ttl(&env, &vault_key);
        extend_persistent_ttl(&env, &registered_key);

        let event = DepositEvent {
            sender: sender.clone(),
            token: token.clone(),
            amount,
            balance: new_balance,
        };
        env.events()
            .publish((symbol_short!("deposit"), sender, token), event);

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spend_offline(
        env: Env,
        gateway: Address,
        sender: Address,
        token: Address,
        receiver: Address,
        amount: i128,
        protocol_toll: i128,
        nonce: BytesN<32>,
        signature: BytesN<64>,
    ) -> Result<(), ContractError> {
        if amount <= 0 || protocol_toll < 0 {
            return Err(ContractError::InvalidAmount);
        }

        gateway.require_auth();

        // ── Gateway Whitelist Firewall ────────────────────────────────────────
        // Single `.has()` call – cheapest possible persistent read.
        // If the key is live, also bump its TTL to prevent accidental archival.
        let gateway_key = DataKey::Gateway(gateway.clone());
        if !env.storage().persistent().has(&gateway_key) {
            return Err(ContractError::NotWhitelistedGateway);
        }
        extend_persistent_ttl(&env, &gateway_key);
        // ─────────────────────────────────────────────────────────────────────

        let registered_key = DataKey::RegisteredKey(sender.clone());
        let sender_pubkey: BytesN<32> = env
            .storage()
            .persistent()
            .get(&registered_key)
            .unwrap_or_else(|| panic_with_error!(&env, ContractError::Unauthorized));
        extend_persistent_ttl(&env, &registered_key);

        // Signature payload: (amount, protocol_toll, nonce, receiver, gateway, token)
        let payload = (
            amount,
            protocol_toll,
            nonce.clone(),
            receiver.clone(),
            gateway.clone(),
            token.clone(),
        )
            .to_xdr(&env);
        env.crypto()
            .ed25519_verify(&sender_pubkey, &payload, &signature);

        let nonce_key = DataKey::Nonce(nonce.clone());
        if env.storage().persistent().has(&nonce_key) {
            extend_persistent_ttl(&env, &nonce_key);
            return Err(ContractError::NonceReplayed);
        }

        let total_deduction = amount
            .checked_add(protocol_toll)
            .ok_or(ContractError::MathOverflow)?;

        let vault_key = DataKey::Vault(sender.clone(), token.clone());
        let current_balance: i128 = env
            .storage()
            .persistent()
            .get(&vault_key)
            .ok_or(ContractError::InsufficientBalance)?;
        extend_persistent_ttl(&env, &vault_key);

        if current_balance < total_deduction {
            return Err(ContractError::InsufficientBalance);
        }

        let new_balance = current_balance
            .checked_sub(total_deduction)
            .ok_or(ContractError::MathOverflow)?;
        let treasury: Address = env
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .ok_or(ContractError::Unauthorized)?;

        env.storage().persistent().set(&nonce_key, &true);
        extend_persistent_ttl(&env, &nonce_key);
        env.storage().persistent().set(&vault_key, &new_balance);
        extend_persistent_ttl(&env, &vault_key);

        let token_client = token::Client::new(&env, &token);
        let contract = env.current_contract_address();
        token_client.transfer(&contract, &receiver, &amount);
        if protocol_toll > 0 {
            token_client.transfer(&contract, &treasury, &protocol_toll);
        }

        let event = SpendEvent {
            sender: sender.clone(),
            gateway: gateway.clone(),
            token: token.clone(),
            receiver: receiver.clone(),
            amount,
            protocol_toll,
            nonce,
            balance: new_balance,
        };
        env.events()
            .publish((symbol_short!("spend"), sender, token), event);

        Ok(())
    }

    pub fn withdraw(
        env: Env,
        sender: Address,
        token: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        // Cheapest guard first — no storage reads or auth required.
        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }

        sender.require_auth();

        let vault_key = DataKey::Vault(sender.clone(), token.clone());
        let balance: i128 = env
            .storage()
            .persistent()
            .get(&vault_key)
            .ok_or(ContractError::InsufficientBalance)?;

        if balance < amount {
            return Err(ContractError::InsufficientBalance);
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &sender, &amount);

        if balance == amount {
            // Full withdrawal — remove the entry to refund storage rent.
            env.storage().persistent().remove(&vault_key);
        } else {
            // Partial withdrawal — persist the residual balance and keep the
            // entry alive so the Sender can withdraw the rest later.
            let new_balance = balance
                .checked_sub(amount)
                .ok_or(ContractError::MathOverflow)?;
            env.storage().persistent().set(&vault_key, &new_balance);
            extend_persistent_ttl(&env, &vault_key);
        }

        let event = WithdrawEvent {
            sender: sender.clone(),
            token: token.clone(),
            amount,
        };
        env.events()
            .publish((symbol_short!("withdraw"), sender, token), event);

        Ok(())
    }

    pub fn get_vault(env: Env, user: Address, token: Address) -> i128 {
        let vault_key = DataKey::Vault(user, token);
        env.storage().persistent().get(&vault_key).unwrap_or(0)
    }

    /// Whitelist a gateway relayer address.
    ///
    /// Only the stored admin may call this. The value written is a compact
    /// boolean (`true`) to minimise ledger entry size.
    pub fn register_gateway(
        env: Env,
        admin: Address,
        gateway: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::Unauthorized)?;
        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
        }

        let key = DataKey::Gateway(gateway);
        env.storage().persistent().set(&key, &true);
        extend_persistent_ttl(&env, &key);

        Ok(())
    }

    /// Remove a previously whitelisted gateway relayer.
    ///
    /// Only the stored admin may call this.
    pub fn remove_gateway(
        env: Env,
        admin: Address,
        gateway: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::Unauthorized)?;
        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::Gateway(gateway));

        Ok(())
    }
}

fn get_persistent_i128(env: &Env, key: &DataKey) -> i128 {
    if env.storage().persistent().has(key) {
        extend_persistent_ttl(env, key);
    }
    env.storage().persistent().get(key).unwrap_or(0)
}

fn extend_persistent_ttl(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, DAY_IN_LEDGERS, THIRTY_DAYS_IN_LEDGERS);
}

#[cfg(test)]
mod test;
