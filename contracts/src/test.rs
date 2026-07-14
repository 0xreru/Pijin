#![cfg(test)]

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use soroban_sdk::{testutils::Address as _, token, Address, Bytes, BytesN, Env};

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

    /// Build and sign a spend payload for the given token.
    ///
    /// Payload structure (6-item tuple):
    /// (amount, protocol_toll, nonce, receiver_short_id, gateway, token)
    fn sign_payload_for(
        &self,
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
        )
            .to_xdr(&self.env);
        let payload_buffer = payload.to_buffer::<1024>();
        let signature = self.signing_key.sign(payload_buffer.as_slice()).to_bytes();
        BytesN::from_array(&self.env, &signature)
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
