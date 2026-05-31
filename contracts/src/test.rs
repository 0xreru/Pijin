#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token, Address, BytesN, Env,
};

// ---------------------------------------------------------------------------
// Test Harness Setup
// ---------------------------------------------------------------------------
fn setup_test<'a>() -> (Env, AbotPeraContractClient<'a>, Address, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths(); // Bypasses signature checks for pure logic testing

    let contract_id = env.register(AbotPeraContract, ());
    let client = AbotPeraContractClient::new(&env, &contract_id);

    // Create Test Accounts
    let admin = Address::generate(&env);
    let gateway = Address::generate(&env); // The Next.js Relayer
    let customer = Address::generate(&env);
    let merchant = Address::generate(&env);
    
    // Setup Native Token
    let token_address = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_admin = token::StellarAssetClient::new(&env, &token_address);
    token_admin.mint(&customer, &10_000_i128); // Give customer 10,000 to start

    (env, client, contract_id, token_address, gateway, customer, merchant)
}

// ---------------------------------------------------------------------------
// The Tests
// ---------------------------------------------------------------------------

#[test]
fn test_end_to_end_payment() {
    let (env, client, _id, token, gateway, customer, merchant) = setup_test();

    // 1. Customer Deposits 1000
    client.deposit(&customer, &token, &1_000_i128);
    assert_eq!(client.get_vault(&customer), 1_000_i128);

    // 2. Gateway settles a 500 offline spend
    let nonce = BytesN::from_array(&env, &[1u8; 32]);
    client.spend_offline(
        &gateway,
        &customer,
        &merchant,
        &token,
        &500_i128,
        &nonce,
        &999_999_999, // Expiry
    );

    // 3. Verify Balances
    assert_eq!(client.get_vault(&customer), 500_i128); // Vault deducted
    
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&merchant), 500_i128); // Merchant received
}

#[test]
#[should_panic(expected = "Transaction Reverted: This offline code has already been spent.")]
fn test_double_spend_prevention() {
    let (env, client, _id, token, gateway, customer, merchant) = setup_test();

    client.deposit(&customer, &token, &1_000_i128);
    let nonce = BytesN::from_array(&env, &[9u8; 32]);

    // First spend succeeds
    client.spend_offline(&gateway, &customer, &merchant, &token, &100_i128, &nonce, &999999999);

    // Second spend with the EXACT same nonce must panic!
    client.spend_offline(&gateway, &customer, &merchant, &token, &100_i128, &nonce, &999999999);
}

#[test]
#[should_panic(expected = "Transaction Reverted: Vault is locked for 24 hours")]
fn test_withdraw_timelock_fails_early() {
    let (_env, client, _id, token, _gateway, customer, _merchant) = setup_test();

    client.deposit(&customer, &token, &1_000_i128);
    
    // Customer tries to withdraw immediately (Should Panic)
    client.withdraw(&customer, &token);
}

#[test]
fn test_withdraw_success_after_24_hours() {
    let (env, client, _id, token, _gateway, customer, _merchant) = setup_test();

    client.deposit(&customer, &token, &1_000_i128);

    // Time Travel: Fast forward the blockchain clock 25 hours
    let current_time = env.ledger().timestamp();
    env.ledger().with_mut(|li| li.timestamp = current_time + (25 * 60 * 60));

    // Withdraw should now succeed
    client.withdraw(&customer, &token);

    // Vault should be empty
    assert_eq!(client.get_vault(&customer), 0_i128);
}