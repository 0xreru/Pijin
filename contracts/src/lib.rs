#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, token, Address, BytesN, Env
};

// ---------------------------------------------------------------------------
// TTL Constants (Network Rent & Archival Prevention)
// 1 ledger ≈ 5 seconds on Stellar Mainnet
// ---------------------------------------------------------------------------
const DAY_IN_LEDGERS: u32 = 17_280;
const THIRTY_DAYS_IN_LEDGERS: u32 = DAY_IN_LEDGERS * 30;

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Vault(Address),    // Persistent: Customer → Locked Balance (i128)
    Nonce(BytesN<32>), // Temporary:  Nonce → bool (Double-Spend Protection)
    Timelock(Address), // Persistent: Customer → Unlock Timestamp (u64)
}

// ---------------------------------------------------------------------------
// Events (For Next.js Indexing & Receipts)
// ---------------------------------------------------------------------------
#[derive(Clone, Debug, PartialEq)]
#[contractevent]
pub struct DepositEvent {
    #[topic]
    pub customer: Address,
    pub token: Address,
    pub amount: i128,
}

#[derive(Clone, Debug, PartialEq)]
#[contractevent]
pub struct SpendEvent {
    #[topic]
    pub customer: Address,
    #[topic]
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
}

#[derive(Clone, Debug, PartialEq)]
#[contractevent]
pub struct WithdrawEvent {
    #[topic]
    pub customer: Address,
    pub token: Address,
    pub amount: i128,
}

// ---------------------------------------------------------------------------
// Smart Contract Implementation
// ---------------------------------------------------------------------------
#[contract]
pub struct AbotPeraContract;

#[contractimpl]
impl AbotPeraContract {
    
    /// User locks funds while online. 
    /// Sets a 24-hour timelock to guarantee the merchant has time to text the receipt.
    pub fn deposit(env: Env, customer: Address, token: Address, amount: i128) {
        customer.require_auth();

        if amount <= 0 {
            panic!("Transaction Reverted: Deposit amount must be positive.");
        }

        let client = token::Client::new(&env, &token);
        client.transfer(&customer, &env.current_contract_address(), &amount);

        // Update Vault Balance
        let vault_key = DataKey::Vault(customer.clone());
        let mut balance: i128 = env.storage().persistent().get(&vault_key).unwrap_or(0);
        balance += amount;
        env.storage().persistent().set(&vault_key, &balance);

        // Set Timelock (24 Hours from now)
        let timelock_key = DataKey::Timelock(customer.clone());
        let current_time = env.ledger().timestamp();
        let unlock_time = current_time + (24 * 60 * 60); // 24 hours in seconds
        env.storage().persistent().set(&timelock_key, &unlock_time);

        // Pay State Rent (Keep storage alive for 30 days)
        env.storage().persistent().extend_ttl(&vault_key, DAY_IN_LEDGERS, THIRTY_DAYS_IN_LEDGERS);
        env.storage().persistent().extend_ttl(&timelock_key, DAY_IN_LEDGERS, THIRTY_DAYS_IN_LEDGERS);

        DepositEvent { customer, token, amount }.publish(&env);
    }

    /// The Trusted Gateway (Next.js) submits the offline SMS transaction.
    pub fn spend_offline(
        env: Env,
        gateway: Address,     // The Next.js Relayer (Pays the Gas)
        customer: Address,    // The offline user who signed the text
        merchant: Address,    // The offline merchant receiving funds
        token: Address,
        amount: i128,
        nonce: BytesN<32>,
        expiry_ledger: u32,
    ) {
        // 1. Authenticate the Trusted Gateway (Not the offline customer)
        gateway.require_auth();

        // 2. Expiry Check
        if env.ledger().sequence() > expiry_ledger {
            panic!("Transaction Reverted: Offline voucher has expired.");
        }

        // 3. Replay Protection (Double-Spend Check)
        let nonce_key = DataKey::Nonce(nonce.clone());
        if env.storage().temporary().has(&nonce_key) {
            panic!("Transaction Reverted: This offline code has already been spent.");
        }

        // 4. Vault Balance Check
        let vault_key = DataKey::Vault(customer.clone());
        let mut balance: i128 = env.storage().persistent().get(&vault_key).unwrap_or(0);
        if balance < amount {
            panic!("Transaction Reverted: Insufficient locked funds.");
        }

        // 5. Execute State Changes
        balance -= amount;
        env.storage().persistent().set(&vault_key, &balance);
        
        // Mark nonce as used in TEMPORARY storage (Cheaper Gas!)
        env.storage().temporary().set(&nonce_key, &true);
        env.storage().temporary().extend_ttl(&nonce_key, DAY_IN_LEDGERS, THIRTY_DAYS_IN_LEDGERS);

        // 6. Transfer Funds to Merchant
        let client = token::Client::new(&env, &token);
        client.transfer(&env.current_contract_address(), &merchant, &amount);

        SpendEvent { customer, merchant, token, amount }.publish(&env);
    }

    /// Customer withdraws remaining funds once the 24-hour escrow window closes.
    pub fn withdraw(env: Env, customer: Address, token: Address) {
        customer.require_auth();

        let timelock_key = DataKey::Timelock(customer.clone());
        let unlock_time: u64 = env.storage().persistent().get(&timelock_key).unwrap_or(0);
        
        if env.ledger().timestamp() < unlock_time {
            panic!("Transaction Reverted: Vault is locked for 24 hours to protect offline merchants.");
        }

        let vault_key = DataKey::Vault(customer.clone());
        let balance: i128 = env.storage().persistent().get(&vault_key).unwrap_or(0);
        
        if balance > 0 {
            let client = token::Client::new(&env, &token);
            client.transfer(&env.current_contract_address(), &customer, &balance);

            // Clean up storage (Refunds gas to the contract)
            env.storage().persistent().remove(&vault_key);
            env.storage().persistent().remove(&timelock_key);

            WithdrawEvent { customer, token, amount: balance }.publish(&env);
        } else {
            panic!("Transaction Reverted: No funds to withdraw.");
        }
    }

    /// View function for frontend dashboards
    pub fn get_vault(env: Env, customer: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Vault(customer)).unwrap_or(0)
    }
}

mod test;