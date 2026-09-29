#![cfg(test)]

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use soroban_sdk::{testutils::Address as _, token, Address, Bytes, BytesN, Env, String};

const INITIAL_BALANCE: i128 = 1_000_000_000;
const DEPOSIT_AMOUNT: i128 = 500_000_000;

// ─── Test context ──────────────────────────────────────────────────────────────

struct TestContext {
    env: Env,
    contract_id: Address,
    #[allow(dead_code)]
    admin: Address,
    treasury: Address,
    gateway: Address,
    receiver: Address,
    receiver_short_id: BytesN<6>,
    sender: Address,
    /// Primary token (e.g. PHPC)
    token_a: Address,
    /// Secondary token (e.g. USDC)
    token_b: Address,
    signing_key: SigningKey,
}

impl TestContext {
    fn client(&self) -> PijinContractClient<'_> {
        PijinContractClient::new(&self.env, &self.contract_id)
    }

    fn token_client_a(&self) -> token::TokenClient<'_> {
        token::TokenClient::new(&self.env, &self.token_a)
    }

    fn token_client_b(&self) -> token::TokenClient<'_> {
        token::TokenClient::new(&self.env, &self.token_b)
    }

    fn pubkey(&self) -> BytesN<32> {
        BytesN::from_array(&self.env, &self.signing_key.verifying_key().to_bytes())
    }

    /// Convenience: deposit `amount` of `token` into the Sender's vault.
    fn deposit_token(&self, token: &Address, amount: i128) {
        self.client()
            .deposit(&self.sender, token, &self.pubkey(), &amount);
    }

    /// Convenience: deposit `amount` of Token A into the Sender's vault.
    fn deposit(&self, amount: i128) {
        self.deposit_token(&self.token_a.clone(), amount);
    }

    /// Build and sign a spend payload for the given contract and token.
    ///
    /// Payload structure (7-item tuple):
    /// (amount, protocol_toll, nonce, receiver_short_id, gateway, token, contract)
    fn sign_payload_for_contract(
        &self,
        contract: &Address,
        token: &Address,
        amount: i128,
        protocol_toll: i128,
        nonce: &BytesN<32>,
        receiver_short_id: &BytesN<6>,
        gateway: &Address,
    ) -> BytesN<64> {
        let payload: Bytes = (
            amount,
            protocol_toll,
            nonce.clone(),
            receiver_short_id.clone(),
            gateway.clone(),
            token.clone(),
            contract.clone(),
        )
            .to_xdr(&self.env);
        let payload_buffer = payload.to_buffer::<1024>();
        let signature = self.signing_key.sign(payload_buffer.as_slice()).to_bytes();
        BytesN::from_array(&self.env, &signature)
    }

    /// Build and sign a spend payload for the current contract and given token.
    fn sign_payload_for(
        &self,
        token: &Address,
        amount: i128,
        protocol_toll: i128,
        nonce: &BytesN<32>,
        receiver_short_id: &BytesN<6>,
        gateway: &Address,
    ) -> BytesN<64> {
        self.sign_payload_for_contract(
            &self.contract_id,
            token,
            amount,
            protocol_toll,
            nonce,
            receiver_short_id,
            gateway,
        )
    }

    /// Sign using Token A (backwards-compatible helper used by most existing tests).
    fn sign_payload(
        &self,
        amount: i128,
        protocol_toll: i128,
        nonce: &BytesN<32>,
        receiver_short_id: &BytesN<6>,
        gateway: &Address,
    ) -> BytesN<64> {
        self.sign_payload_for(
            &self.token_a.clone(),
            amount,
            protocol_toll,
            nonce,
            receiver_short_id,
            gateway,
        )
    }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

/// Build a fully-wired test environment with TWO independent mock tokens.
///
/// - `token_a` represents PHPC (primary).
/// - `token_b` represents USDC (secondary).
///
/// The contract is initialised without a locked token (`__constructor` now only
/// takes `admin` + `treasury`). The Sender is minted `INITIAL_BALANCE` of
/// **both** tokens so individual tests can choose which asset to use.
fn setup_test() -> TestContext {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let gateway = Address::generate(&env);
    let receiver = Address::generate(&env);
    let receiver_short_id = BytesN::from_array(&env, b"aB3x9Q");

    // ── Token A (PHPC) ────────────────────────────────────────────────────────
    let token_a_admin = Address::generate(&env);
    let token_a_id = env.register_stellar_asset_contract_v2(token_a_admin.clone());
    let token_a = token_a_id.address();

    // ── Token B (USDC) ────────────────────────────────────────────────────────
    let token_b_admin = Address::generate(&env);
    let token_b_id = env.register_stellar_asset_contract_v2(token_b_admin.clone());
    let token_b = token_b_id.address();

    // ── Contract (Omni-Vault — no single-token lock) ──────────────────────────
    let contract_id = env.register(PijinContract, (&admin, &treasury));

    let signing_key = SigningKey::generate(&mut OsRng);
    let sender = Address::generate(&env);

    // Fund sender with both tokens.
    token::StellarAssetClient::new(&env, &token_a).mint(&sender, &INITIAL_BALANCE);
    token::StellarAssetClient::new(&env, &token_b).mint(&sender, &INITIAL_BALANCE);

    let client = PijinContractClient::new(&env, &contract_id);
    client.register_gateway(&admin, &gateway);
    client.register_recipient(&admin, &receiver_short_id, &receiver);

    TestContext {
        env,
        contract_id,
        admin,
        treasury,
        gateway,
        receiver,
        receiver_short_id,
        sender,
        token_a,
        token_b,
        signing_key,
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[test]
fn test_deposit_and_withdraw_success() {
    let ctx = setup_test();
    let token_client = ctx.token_client_a();

    ctx.deposit(DEPOSIT_AMOUNT);

    assert_eq!(
        token_client.balance(&ctx.sender),
        INITIAL_BALANCE - DEPOSIT_AMOUNT
    );
    assert_eq!(token_client.balance(&ctx.contract_id), DEPOSIT_AMOUNT);

    // Withdraw is now instant — no timelock to advance past.
    // Pass the full deposited amount for a complete withdrawal.
    ctx.client()
        .withdraw(&ctx.sender, &ctx.token_a, &DEPOSIT_AMOUNT);

    assert_eq!(token_client.balance(&ctx.sender), INITIAL_BALANCE);
    assert_eq!(token_client.balance(&ctx.contract_id), 0);
}

#[test]
fn test_deposit_does_not_rotate_existing_offline_key() {
    let ctx = setup_test();
    ctx.deposit(DEPOSIT_AMOUNT);
    let enrolled_key = ctx.client().get_offline_key(&ctx.sender).unwrap();

    let replacement = SigningKey::generate(&mut OsRng);
    let replacement_key = BytesN::from_array(&ctx.env, &replacement.verifying_key().to_bytes());
    ctx.client()
        .deposit(&ctx.sender, &ctx.token_a, &replacement_key, &1);

    assert_eq!(
        ctx.client().get_offline_key(&ctx.sender),
        Some(enrolled_key)
    );
}

#[test]
fn test_spend_offline_success() {
    let ctx = setup_test();
    let amount = 100_000_000;
    let receiver_online_balance = 2_000_000_000;
    let protocol_toll = 5_000_000;
    let nonce = BytesN::from_array(&ctx.env, &[1; 32]);
    let signature = ctx.sign_payload(
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver_short_id,
        &ctx.gateway,
    );

    ctx.deposit(DEPOSIT_AMOUNT);
    // Mirror the reported regression: the receiver starts with an existing
    // online wallet balance. An offline-to-offline spend must not change it.
    token::StellarAssetClient::new(&ctx.env, &ctx.token_a)
        .mint(&ctx.receiver, &receiver_online_balance);
    ctx.client().spend_offline(
        &ctx.gateway,
        &ctx.sender,
        &ctx.token_a,
        &ctx.receiver_short_id,
        &amount,
        &protocol_toll,
        &nonce,
        &signature,
    );

    let token_client = ctx.token_client_a();
    assert_eq!(token_client.balance(&ctx.receiver), receiver_online_balance);
    assert_eq!(ctx.client().get_vault(&ctx.receiver, &ctx.token_a), amount);
    assert_eq!(token_client.balance(&ctx.treasury), protocol_toll);
    assert_eq!(
        token_client.balance(&ctx.contract_id),
        DEPOSIT_AMOUNT - protocol_toll
    );
}

#[test]
#[should_panic]
fn test_spend_offline_invalid_signature_traps() {
    let ctx = setup_test();
    let signed_amount = 100_000_000;
    let mutated_amount = signed_amount + 1;
    let protocol_toll = 5_000_000;
    let nonce = BytesN::from_array(&ctx.env, &[2; 32]);
    let signature = ctx.sign_payload(
        signed_amount,
        protocol_toll,
        &nonce,
        &ctx.receiver_short_id,
        &ctx.gateway,
    );

    ctx.deposit(DEPOSIT_AMOUNT);
    ctx.client().spend_offline(
        &ctx.gateway,
        &ctx.sender,
        &ctx.token_a,
        &ctx.receiver_short_id,
        &mutated_amount,
        &protocol_toll,
        &nonce,
        &signature,
    );
}

#[test]
fn test_spend_offline_nonce_replayed() {
    let ctx = setup_test();
    let amount = 100_000_000;
    let protocol_toll = 5_000_000;
    let nonce = BytesN::from_array(&ctx.env, &[3; 32]);
    let signature = ctx.sign_payload(
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver_short_id,
        &ctx.gateway,
    );

    ctx.deposit(DEPOSIT_AMOUNT);
    ctx.client().spend_offline(
        &ctx.gateway,
        &ctx.sender,
        &ctx.token_a,
        &ctx.receiver_short_id,
        &amount,
        &protocol_toll,
        &nonce,
        &signature,
    );

    assert_eq!(
        ctx.client().try_spend_offline(
            &ctx.gateway,
            &ctx.sender,
            &ctx.token_a,
            &ctx.receiver_short_id,
            &amount,
            &protocol_toll,
            &nonce,
            &signature,
        ),
        Err(Ok(ContractError::NonceReplayed))
    );
}

#[test]
fn test_spend_offline_insufficient_balance() {
    let ctx = setup_test();
    let amount = 40;
    let protocol_toll = 1;
    let nonce = BytesN::from_array(&ctx.env, &[4; 32]);
    let _signature = ctx.sign_payload(
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver_short_id,
        &ctx.gateway,
    );

    ctx.deposit(50);

    // total_deduction = 40 + 1 = 41, but balance after deposit fee check is 50.
    // This passes the balance check (50 >= 41), so use a tighter case:
    // amount=40, toll=15 → deduction=55 > 50 → InsufficientBalance.
    let amount2 = 40;
    let toll2 = 15;
    let nonce2 = BytesN::from_array(&ctx.env, &[5; 32]);
    let sig2 = ctx.sign_payload(
        amount2,
        toll2,
        &nonce2,
        &ctx.receiver_short_id,
        &ctx.gateway,
    );

    assert_eq!(
        ctx.client().try_spend_offline(
            &ctx.gateway,
            &ctx.sender,
            &ctx.token_a,
            &ctx.receiver_short_id,
            &amount2,
            &toll2,
            &nonce2,
            &sig2,
        ),
        Err(Ok(ContractError::InsufficientBalance))
    );
}

#[test]
fn test_spend_offline_fails_unregistered_gateway() {
    let ctx = setup_test();

    // A brand-new address that was never passed to register_gateway.
    let malicious_gateway = Address::generate(&ctx.env);

    let amount = 100_000_000;
    let protocol_toll = 5_000_000;
    // Use a unique nonce to avoid any interference with other tests.
    let nonce = BytesN::from_array(&ctx.env, &[99; 32]);

    // Sign the payload as if the malicious gateway were legitimate.
    let signature = ctx.sign_payload_for(
        &ctx.token_a.clone(),
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver_short_id,
        &malicious_gateway,
    );

    ctx.deposit(DEPOSIT_AMOUNT);

    // The firewall must reject this before any business logic executes.
    assert_eq!(
        ctx.client().try_spend_offline(
            &malicious_gateway,
            &ctx.sender,
            &ctx.token_a,
            &ctx.receiver_short_id,
            &amount,
            &protocol_toll,
            &nonce,
            &signature,
        ),
        Err(Ok(ContractError::NotWhitelistedGateway))
    );
}

// ─── Omni-Vault tests ─────────────────────────────────────────────────────────

/// Happy-path asset isolation:
/// - Deposit 1,000 Token A **and** 500 Token B into the Sender's vault.
/// - Execute `spend_offline` using Token A.
/// - Assert the Receiver and Treasury are paid in Token A.
/// - Assert the Sender's Token B vault is exactly 500 (untouched).
#[test]
fn test_omni_vault_isolation() {
    let ctx = setup_test();

    let deposit_a: i128 = 1_000_000_000; // 1,000 (7-decimal tokens)
    let deposit_b: i128 = 500_000_000; //   500

    // Deposit both tokens into the Sender's independent vault slots.
    ctx.deposit_token(&ctx.token_a.clone(), deposit_a);
    ctx.deposit_token(&ctx.token_b.clone(), deposit_b);

    // Spend some Token A.
    let amount = 200_000_000;
    let protocol_toll = 5_000_000;
    let nonce = BytesN::from_array(&ctx.env, &[10; 32]);
    let signature = ctx.sign_payload_for(
        &ctx.token_a.clone(),
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver_short_id,
        &ctx.gateway,
    );

    ctx.client().spend_offline(
        &ctx.gateway,
        &ctx.sender,
        &ctx.token_a,
        &ctx.receiver_short_id,
        &amount,
        &protocol_toll,
        &nonce,
        &signature,
    );

    // ── Token A assertions ────────────────────────────────────────────────────
    let tc_a = ctx.token_client_a();
    // Receiver got the payment in their internal Token A vault.
    assert_eq!(tc_a.balance(&ctx.receiver), 0);
    assert_eq!(ctx.client().get_vault(&ctx.receiver, &ctx.token_a), amount);
    // Treasury got the toll in Token A.
    assert_eq!(tc_a.balance(&ctx.treasury), protocol_toll);
    // Sender's on-chain Token A vault was debited correctly (no bounty fee).
    assert_eq!(
        ctx.client().get_vault(&ctx.sender, &ctx.token_a),
        deposit_a - amount - protocol_toll
    );

    // ── Token B assertions ────────────────────────────────────────────────────
    let tc_b = ctx.token_client_b();
    // Receiver received nothing in Token B.
    assert_eq!(tc_b.balance(&ctx.receiver), 0);
    // Sender's Token B vault is completely untouched.
    assert_eq!(
        ctx.client().get_vault(&ctx.sender, &ctx.token_b),
        deposit_b,
        "Token B vault must be untouched after a Token A spend"
    );
}

/// Cross-asset insufficient-funds edge case:
/// - Deposit `INITIAL_BALANCE` of Token A but leave Token B vault empty.
/// - Attempt `spend_offline` using Token B.
/// - Must fail strictly with `ContractError::InsufficientBalance`.
///
/// The Sender is minted `INITIAL_BALANCE` of each token in `setup_test`, but
/// since we never call `deposit_token` for Token B, the vault key simply does
/// not exist (reads as 0), triggering the insufficient-balance guard.
#[test]
fn test_insufficient_funds_cross_asset() {
    let ctx = setup_test();

    // Deposit only Token A; Token B vault is intentionally left empty.
    ctx.deposit_token(&ctx.token_a.clone(), INITIAL_BALANCE);

    let amount = 100_000_000;
    let protocol_toll = 5_000_000;
    let nonce = BytesN::from_array(&ctx.env, &[20; 32]);

    // Sign for Token B even though there is no Token B in the vault.
    let signature = ctx.sign_payload_for(
        &ctx.token_b.clone(),
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver_short_id,
        &ctx.gateway,
    );

    assert_eq!(
        ctx.client().try_spend_offline(
            &ctx.gateway,
            &ctx.sender,
            &ctx.token_b, // ← Token B, vault is empty → balance == 0
            &ctx.receiver_short_id,
            &amount,
            &protocol_toll,
            &nonce,
            &signature,
        ),
        Err(Ok(ContractError::InsufficientBalance)),
        "spend_offline must fail with InsufficientBalance when the Token B vault is empty"
    );
}

#[test]
fn test_recipient_registry_is_case_sensitive_and_idempotent() {
    let ctx = setup_test();
    assert_eq!(ctx.client().get_registrar(), Some(ctx.admin.clone()));
    let same_mapping =
        ctx.client()
            .try_register_recipient(&ctx.admin, &ctx.receiver_short_id, &ctx.receiver);
    assert_eq!(same_mapping, Ok(Ok(())));

    let different_case = BytesN::from_array(&ctx.env, b"AB3x9Q");
    let other_receiver = Address::generate(&ctx.env);
    ctx.client()
        .register_recipient(&ctx.admin, &different_case, &other_receiver);

    assert_eq!(
        ctx.client().get_recipient(&ctx.receiver_short_id),
        Some(ctx.receiver.clone())
    );
    assert_eq!(
        ctx.client().get_recipient(&different_case),
        Some(other_receiver)
    );
}

#[test]
fn test_recipient_registry_rejects_conflicting_mapping() {
    let ctx = setup_test();
    let conflicting_receiver = Address::generate(&ctx.env);
    assert_eq!(
        ctx.client().try_register_recipient(
            &ctx.admin,
            &ctx.receiver_short_id,
            &conflicting_receiver,
        ),
        Err(Ok(ContractError::ShortIdAlreadyRegistered))
    );
}

#[test]
fn test_recipient_registry_rejects_wrong_registrar() {
    let ctx = setup_test();
    let wrong_registrar = Address::generate(&ctx.env);
    let short_id = BytesN::from_array(&ctx.env, b"Z9y8X7");
    assert_eq!(
        ctx.client()
            .try_register_recipient(&wrong_registrar, &short_id, &ctx.receiver,),
        Err(Ok(ContractError::Unauthorized))
    );
}

#[test]
fn test_recipient_registry_rejects_non_base62_id() {
    let ctx = setup_test();
    let invalid_short_id = BytesN::from_array(&ctx.env, b"bad-id");
    assert_eq!(
        ctx.client()
            .try_register_recipient(&ctx.admin, &invalid_short_id, &ctx.receiver),
        Err(Ok(ContractError::InvalidShortId))
    );
}

#[test]
fn test_spend_offline_rejects_unknown_recipient() {
    let ctx = setup_test();
    let unknown_short_id = BytesN::from_array(&ctx.env, b"NoSuch");
    let amount = 100;
    let toll = 5;
    let nonce = BytesN::from_array(&ctx.env, &[77; 32]);
    let signature = ctx.sign_payload(amount, toll, &nonce, &unknown_short_id, &ctx.gateway);
    ctx.deposit(DEPOSIT_AMOUNT);

    assert_eq!(
        ctx.client().try_spend_offline(
            &ctx.gateway,
            &ctx.sender,
            &ctx.token_a,
            &unknown_short_id,
            &amount,
            &toll,
            &nonce,
            &signature,
        ),
        Err(Ok(ContractError::RecipientNotFound))
    );
}

#[test]
#[should_panic]
fn test_spend_offline_signature_binds_exact_short_id() {
    let ctx = setup_test();
    let other_short_id = BytesN::from_array(&ctx.env, b"Ab3x9Q");
    ctx.client()
        .register_recipient(&ctx.admin, &other_short_id, &ctx.receiver);

    let amount = 100;
    let toll = 5;
    let nonce = BytesN::from_array(&ctx.env, &[78; 32]);
    let signature = ctx.sign_payload(amount, toll, &nonce, &ctx.receiver_short_id, &ctx.gateway);
    ctx.deposit(DEPOSIT_AMOUNT);

    ctx.client().spend_offline(
        &ctx.gateway,
        &ctx.sender,
        &ctx.token_a,
        &other_short_id,
        &amount,
        &toll,
        &nonce,
        &signature,
    );
}

// ─── Withdraw tests ───────────────────────────────────────────────────────────

/// Partial withdrawal:
/// - Deposit 500 stroops of Token A.
/// - Withdraw 200 stroops.
/// - Assert the vault balance is exactly 300 stroops.
#[test]
fn test_withdraw_partial() {
    let ctx = setup_test();
    let deposit: i128 = 500;
    let withdraw: i128 = 200;
    let expected_residual: i128 = 300;

    ctx.deposit(deposit);

    // Pre-condition: full deposit is recorded.
    assert_eq!(ctx.client().get_vault(&ctx.sender, &ctx.token_a), deposit);

    ctx.client().withdraw(&ctx.sender, &ctx.token_a, &withdraw);

    // Vault must hold exactly the residual balance.
    assert_eq!(
        ctx.client().get_vault(&ctx.sender, &ctx.token_a),
        expected_residual,
        "Partial withdrawal must leave the residual balance in the vault"
    );
}

/// Full withdrawal:
/// - Deposit 500 stroops of Token A.
/// - Withdraw 500 stroops (the entire balance).
/// - Assert the vault balance is exactly 0 (storage key removed).
#[test]
fn test_withdraw_full() {
    let ctx = setup_test();
    let deposit: i128 = 500;

    ctx.deposit(deposit);

    // Pre-condition: full deposit is recorded.
    assert_eq!(ctx.client().get_vault(&ctx.sender, &ctx.token_a), deposit);

    ctx.client().withdraw(&ctx.sender, &ctx.token_a, &deposit);

    // After a full withdrawal the key is removed; get_vault unwraps to 0.
    assert_eq!(
        ctx.client().get_vault(&ctx.sender, &ctx.token_a),
        0,
        "Full withdrawal must remove the vault entry (reads back as 0)"
    );
}

/// Over-balance withdrawal:
/// - Deposit 500 stroops of Token A.
/// - Attempt to withdraw 600 stroops.
/// - Must fail strictly with `ContractError::InsufficientBalance`.
#[test]
fn test_withdraw_insufficient_balance() {
    let ctx = setup_test();
    let deposit: i128 = 500;
    let overdraw: i128 = 600;

    ctx.deposit(deposit);

    assert_eq!(
        ctx.client()
            .try_withdraw(&ctx.sender, &ctx.token_a, &overdraw),
        Err(Ok(ContractError::InsufficientBalance)),
        "Withdrawing more than the vault balance must return InsufficientBalance"
    );

    // Vault must be untouched after the failed attempt.
    assert_eq!(
        ctx.client().get_vault(&ctx.sender, &ctx.token_a),
        deposit,
        "Vault balance must be unchanged after a failed over-draw"
    );
}

// ─── Advanced Security & Domain Separation Tests ─────────────────────────────

/// Cross-contract domain separation:
/// A signature generated for Contract A must trap when submitted to Contract B.
#[test]
#[should_panic]
fn test_spend_offline_fails_on_different_contract() {
    let ctx = setup_test();

    // Deploy a second contract instance on the same network
    let contract_2_id = ctx.env.register(PijinContract, (&ctx.admin, &ctx.treasury));
    let client_2 = PijinContractClient::new(&ctx.env, &contract_2_id);
    client_2.register_gateway(&ctx.admin, &ctx.gateway);
    client_2.register_recipient(&ctx.admin, &ctx.receiver_short_id, &ctx.receiver);

    // Deposit into Contract 2 for the sender
    client_2.deposit(&ctx.sender, &ctx.token_a, &ctx.pubkey(), &DEPOSIT_AMOUNT);

    let amount = 100_000_000;
    let protocol_toll = 5_000_000;
    let nonce = BytesN::from_array(&ctx.env, &[31; 32]);

    // Sign for contract 1 (ctx.contract_id), NOT contract 2!
    let signature_for_contract_1 = ctx.sign_payload_for_contract(
        &ctx.contract_id,
        &ctx.token_a,
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver_short_id,
        &ctx.gateway,
    );

    // Attempting to spend on Contract 2 with a signature bound to Contract 1 must trap!
    client_2.spend_offline(
        &ctx.gateway,
        &ctx.sender,
        &ctx.token_a,
        &ctx.receiver_short_id,
        &amount,
        &protocol_toll,
        &nonce,
        &signature_for_contract_1,
    );
}

/// Swapped tokens attack:
/// User signs for Token A (PHPC); attacker attempts to spend Token B (USDC) with that signature.
#[test]
#[should_panic]
fn test_spend_offline_swapped_tokens_fails() {
    let ctx = setup_test();

    // Deposit both Token A and Token B into Sender vault
    ctx.deposit_token(&ctx.token_a, DEPOSIT_AMOUNT);
    ctx.deposit_token(&ctx.token_b, DEPOSIT_AMOUNT);

    let amount = 100_000_000;
    let protocol_toll = 5_000_000;
    let nonce = BytesN::from_array(&ctx.env, &[32; 32]);

    // Sign specifically for Token A
    let sig_token_a = ctx.sign_payload_for(
        &ctx.token_a,
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver_short_id,
        &ctx.gateway,
    );

    // Attacker calls spend_offline attempting to debit Token B using Token A signature
    ctx.client().spend_offline(
        &ctx.gateway,
        &ctx.sender,
        &ctx.token_b, // Swapped!
        &ctx.receiver_short_id,
        &amount,
        &protocol_toll,
        &nonce,
        &sig_token_a,
    );
}

/// Unregistered key / unenrolled sender:
/// Calling spend_offline on a sender that never registered an offline key must trap.
#[test]
#[should_panic]
fn test_spend_offline_unregistered_key_fails() {
    let ctx = setup_test();
    let unenrolled_sender = Address::generate(&ctx.env);

    let amount = 100_000_000;
    let protocol_toll = 5_000_000;
    let nonce = BytesN::from_array(&ctx.env, &[33; 32]);
    let dummy_signature = BytesN::from_array(&ctx.env, &[0u8; 64]);

    ctx.client().spend_offline(
        &ctx.gateway,
        &unenrolled_sender,
        &ctx.token_a,
        &ctx.receiver_short_id,
        &amount,
        &protocol_toll,
        &nonce,
        &dummy_signature,
    );
}

/// Gateway impersonation / mismatch attack:
/// Signature is bound to Gateway 1; a different whitelisted Gateway 2 attempts to submit it.
#[test]
#[should_panic]
fn test_spend_offline_gateway_mismatch_fails() {
    let ctx = setup_test();
    ctx.deposit(DEPOSIT_AMOUNT);

    // Register a second whitelisted gateway
    let gateway_2 = Address::generate(&ctx.env);
    ctx.client().register_gateway(&ctx.admin, &gateway_2);

    let amount = 100_000_000;
    let protocol_toll = 5_000_000;
    let nonce = BytesN::from_array(&ctx.env, &[34; 32]);

    // Signature explicitly authorizes ctx.gateway (Gateway 1)
    let signature = ctx.sign_payload_for(
        &ctx.token_a,
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver_short_id,
        &ctx.gateway,
    );

    // Gateway 2 intercepts and tries to submit using Gateway 2's address -> must trap!
    ctx.client().spend_offline(
        &gateway_2,
        &ctx.sender,
        &ctx.token_a,
        &ctx.receiver_short_id,
        &amount,
        &protocol_toll,
        &nonce,
        &signature,
    );
}

/// Protocol toll manipulation:
/// User signs for 0.50 PHPC toll; relayer attempts to strip the toll to 0.
#[test]
#[should_panic]
fn test_spend_offline_tampered_toll_fails() {
    let ctx = setup_test();
    ctx.deposit(DEPOSIT_AMOUNT);

    let amount = 100_000_000;
    let signed_toll = 5_000_000;
    let tampered_toll = 0;
    let nonce = BytesN::from_array(&ctx.env, &[35; 32]);

    let signature = ctx.sign_payload(
        amount,
        signed_toll,
        &nonce,
        &ctx.receiver_short_id,
        &ctx.gateway,
    );

    ctx.client().spend_offline(
        &ctx.gateway,
        &ctx.sender,
        &ctx.token_a,
        &ctx.receiver_short_id,
        &amount,
        &tampered_toll,
        &nonce,
        &signature,
    );
}

/// Key rotation invalidates previously signed vouchers:
/// Sender rotates key to Key 2; vouchers signed with old Key 1 must fail.
#[test]
#[should_panic]
fn test_spend_offline_invalidated_by_key_rotation() {
    let ctx = setup_test();
    ctx.deposit(DEPOSIT_AMOUNT);

    let amount = 100_000_000;
    let protocol_toll = 5_000_000;
    let nonce = BytesN::from_array(&ctx.env, &[36; 32]);

    // Sign voucher with Key 1
    let signature_key_1 = ctx.sign_payload(
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver_short_id,
        &ctx.gateway,
    );

    // Sender rotates key to Key 2
    let replacement = SigningKey::generate(&mut OsRng);
    let key_2 = BytesN::from_array(&ctx.env, &replacement.verifying_key().to_bytes());
    ctx.client().set_offline_key(&ctx.sender, &key_2);

    // Voucher signed with old Key 1 must now trap
    ctx.client().spend_offline(
        &ctx.gateway,
        &ctx.sender,
        &ctx.token_a,
        &ctx.receiver_short_id,
        &amount,
        &protocol_toll,
        &nonce,
        &signature_key_1,
    );
}

/// Zero and negative amount validation:
/// spend_offline must reject amount <= 0 and protocol_toll < 0.
#[test]
fn test_spend_offline_rejects_zero_and_negative_amounts() {
    let ctx = setup_test();
    let nonce = BytesN::from_array(&ctx.env, &[37; 32]);
    let dummy_sig = BytesN::from_array(&ctx.env, &[0u8; 64]);

    // Zero amount
    assert_eq!(
        ctx.client().try_spend_offline(
            &ctx.gateway,
            &ctx.sender,
            &ctx.token_a,
            &ctx.receiver_short_id,
            &0,
            &5_000_000,
            &nonce,
            &dummy_sig,
        ),
        Err(Ok(ContractError::InvalidAmount))
    );

    // Negative amount
    assert_eq!(
        ctx.client().try_spend_offline(
            &ctx.gateway,
            &ctx.sender,
            &ctx.token_a,
            &ctx.receiver_short_id,
            &-100,
            &5_000_000,
            &nonce,
            &dummy_sig,
        ),
        Err(Ok(ContractError::InvalidAmount))
    );

    // Negative toll
    assert_eq!(
        ctx.client().try_spend_offline(
            &ctx.gateway,
            &ctx.sender,
            &ctx.token_a,
            &ctx.receiver_short_id,
            &100,
            &-1,
            &nonce,
            &dummy_sig,
        ),
        Err(Ok(ContractError::InvalidAmount))
    );
}

/// Short ID validation in spend_offline:
/// spend_offline must reject non-Base62 receiver short IDs before storage lookup.
#[test]
fn test_spend_offline_rejects_invalid_short_id() {
    let ctx = setup_test();
    let nonce = BytesN::from_array(&ctx.env, &[38; 32]);
    let dummy_sig = BytesN::from_array(&ctx.env, &[0u8; 64]);

    let invalid_ids = [
        BytesN::from_array(&ctx.env, b"bad-id"),
        BytesN::from_array(&ctx.env, b"123 45"),
        BytesN::from_array(&ctx.env, b"a!cdef"),
    ];

    for bad_id in invalid_ids {
        assert_eq!(
            ctx.client().try_spend_offline(
                &ctx.gateway,
                &ctx.sender,
                &ctx.token_a,
                &bad_id,
                &100,
                &5,
                &nonce,
                &dummy_sig,
            ),
            Err(Ok(ContractError::InvalidShortId))
        );
    }
}

/// Early replay check optimization:
/// Verify that an already-spent nonce is rejected BEFORE signature verification is executed.
#[test]
fn test_spend_offline_replayed_nonce_fails_before_signature_check() {
    let ctx = setup_test();
    let amount = 100_000_000;
    let protocol_toll = 5_000_000;
    let nonce = BytesN::from_array(&ctx.env, &[39; 32]);
    let signature = ctx.sign_payload(
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver_short_id,
        &ctx.gateway,
    );

    ctx.deposit(DEPOSIT_AMOUNT);

    // Initial valid spend
    ctx.client().spend_offline(
        &ctx.gateway,
        &ctx.sender,
        &ctx.token_a,
        &ctx.receiver_short_id,
        &amount,
        &protocol_toll,
        &nonce,
        &signature,
    );

    // Second spend with a completely BOGUS signature.
    // Because Nonce check executes BEFORE ed25519_verify,
    // this must return ContractError::NonceReplayed instead of trapping on invalid signature!
    let bogus_signature = BytesN::from_array(&ctx.env, &[0u8; 64]);
    assert_eq!(
        ctx.client().try_spend_offline(
            &ctx.gateway,
            &ctx.sender,
            &ctx.token_a,
            &ctx.receiver_short_id,
            &amount,
            &protocol_toll,
            &nonce,
            &bogus_signature,
        ),
        Err(Ok(ContractError::NonceReplayed))
    );
}

// ─── GSM-7 160-Character Boundary Suite ─────────────────────────────────────

#[test]
fn test_gsm7_sms_payload_boundary_validation() {
    // Standard payload:
    // {tokenIdStr}:{senderShortId}:{receiverShortId}:{amountBase62}:{nonceB64}:{signatureB64}
    // Unpadded Base64: 32 bytes -> 43 chars, 64 bytes -> 86 chars
    let _nonce_b64 = "KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKio"; // 43 chars
    let _sig_b64 =
        "ovbhRSySAy6FjrTEuyk8xe7Ni6YirlKDDEVZcjyEL51zs/TOnpNxReportK5mSk52A1/FyoRgD35zM0NroinAA"; // 86 chars

    // Case 1: Minimum boundary (1-digit token "1", 1 stroop "1", 6-char IDs, 43-char nonce, 86-char sig)
    // 1 + 1 + 6 + 1 + 6 + 1 + 1 + 1 + 43 + 1 + 86 = 148 chars
    let min_payload = "1:aB3x9Q:Z9y8X7:1:KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKio:ovbhRSySAy6FjrTEuyk8xe7Ni6YirlKDDEVZcjyEL51zs/TOnpNxReportK5mSk52A1/FyoRgD35zM0NroinAA";
    assert_eq!(min_payload.len(), 148);
    assert!(
        min_payload.len() <= 160,
        "Minimum payload must be <= 160 characters"
    );

    // Case 2: Nominal boundary (1-digit token "1", 500 PHP = 5,000,000,000 stroops = 6 chars in Base62 "5L7Vw8")
    // 1 + 1 + 6 + 1 + 6 + 1 + 6 + 1 + 43 + 1 + 86 = 153 chars
    let nominal_payload = "1:aB3x9Q:Z9y8X7:5L7Vw8:KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKio:ovbhRSySAy6FjrTEuyk8xe7Ni6YirlKDDEVZcjyEL51zs/TOnpNxReportK5mSk52A1/FyoRgD35zM0NroinAA";
    assert_eq!(nominal_payload.len(), 153);
    assert!(
        nominal_payload.len() <= 160,
        "Nominal payload must be <= 160 characters"
    );

    // Case 3: Maximum allowed boundary (3-digit token "999", 11-char max u64 Base62 "LygHa16ahYg")
    // 3 + 1 + 6 + 1 + 6 + 1 + 11 + 1 + 43 + 1 + 86 = 160 chars
    let max_payload = "999:aB3x9Q:Z9y8X7:LygHa16ahYg:KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKio:ovbhRSySAy6FjrTEuyk8xe7Ni6YirlKDDEVZcjyEL51zs/TOnpNxReportK5mSk52A1/FyoRgD35zM0NroinAA";
    assert_eq!(
        max_payload.len(),
        160,
        "Max allowed payload must be exactly 160 GSM-7 characters"
    );

    // Case 4: Overflow boundary (leaked Base64 padding '=' on nonce and '==' on signature)
    // 3 + 1 + 6 + 1 + 6 + 1 + 11 + 1 + 44 + 1 + 88 = 163 chars > 160
    let overflow_payload = "999:aB3x9Q:Z9y8X7:LygHa16ahYg:KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKio=:ovbhRSySAy6FjrTEuyk8xe7Ni6YirlKDDEVZcjyEL51zs/TOnpNxReportK5mSk52A1/FyoRgD35zM0NroinAA==";
    assert_eq!(overflow_payload.len(), 163);
    assert!(
        overflow_payload.len() > 160,
        "Padded Base64 must strictly exceed 160 GSM-7 limit"
    );
}

// ─── Cross-Language Golden Vector Test ──────────────────────────────────────

fn hex_char_to_val(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => panic!("invalid hex"),
    }
}

fn hex_to_bytes<const N: usize>(hex_str: &str) -> [u8; N] {
    let mut bytes = [0u8; N];
    let hex_bytes = hex_str.as_bytes();
    for i in 0..N {
        let hi = hex_char_to_val(hex_bytes[i * 2]);
        let lo = hex_char_to_val(hex_bytes[i * 2 + 1]);
        bytes[i] = (hi << 4) | lo;
    }
    bytes
}

/// Verifies 1:1 cross-language serialization parity between TypeScript and Soroban Rust.
#[test]
fn test_cross_language_golden_vector() {
    let env = Env::default();

    let sender_raw_pubkey: [u8; 32] =
        hex_to_bytes("8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c");
    let golden_xdr: [u8; 232] = hex_to_bytes("0000001000000001000000070000000a00000000000000000000000005f5e1000000000a000000000000000000000000004c4b400000000d000000202a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a0000000d0000000661423378395100000000001200000000000000008139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b3940000001200000001030303030303030303030303030303030303030303030303030303030303030300000012000000010404040404040404040404040404040404040404040404040404040404040404");
    let golden_signature: [u8; 64] = hex_to_bytes("a2f6e1452c92032e858eb4c4bb293cc5eecd8ba622ae5283004559723c842f9d73b3f4ce9e937171201cd22cb9992939d80d7f172a11803df9cccd0dae88a700");

    let gateway = Address::from_string(&String::from_str(
        &env,
        "GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U",
    ));
    let token = Address::from_string(&String::from_str(
        &env,
        "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3",
    ));
    let contract = Address::from_string(&String::from_str(
        &env,
        "CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW",
    ));

    let amount: i128 = 100_000_000;
    let protocol_toll: i128 = 5_000_000;
    let nonce = BytesN::from_array(&env, &[0x2a; 32]);
    let receiver_short_id = BytesN::from_array(&env, b"aB3x9Q");

    // Construct the 7-tuple in Soroban Rust
    let rust_tuple = (
        amount,
        protocol_toll,
        nonce,
        receiver_short_id,
        gateway,
        token,
        contract,
    );

    let rust_xdr: Bytes = rust_tuple.to_xdr(&env);
    let rust_xdr_slice = rust_xdr.to_buffer::<1024>();

    // 1. Assert byte-for-byte serialization identity between TypeScript and Rust
    assert_eq!(
        rust_xdr_slice.as_slice(),
        golden_xdr.as_slice(),
        "Rust Soroban to_xdr MUST match TypeScript @stellar/stellar-sdk ScVal Vec serialization 1:1"
    );

    // 2. Assert Ed25519 signature generated by TypeScript verifies cleanly on Soroban host
    let pubkey_bytes = BytesN::from_array(&env, &sender_raw_pubkey);
    let sig_bytes = BytesN::from_array(&env, &golden_signature);
    env.crypto()
        .ed25519_verify(&pubkey_bytes, &rust_xdr, &sig_bytes);
}
