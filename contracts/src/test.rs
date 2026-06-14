#![cfg(test)]

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Bytes, BytesN, Env,
};

const INITIAL_BALANCE: i128 = 1_000_000_000;
const DEPOSIT_AMOUNT: i128 = 500_000_000;
const BOUNTY_FEE: i128 = 10_000_000;

struct TestContext {
    env: Env,
    contract_id: Address,
    #[allow(dead_code)]
    admin: Address,
    treasury: Address,
    gateway: Address,
    receiver: Address,
    relayer: Address,
    sender: Address,
    token: Address,
    signing_key: SigningKey,
}

impl TestContext {
    fn client(&self) -> PijinContractClient<'_> {
        PijinContractClient::new(&self.env, &self.contract_id)
    }

    fn token_client(&self) -> token::TokenClient<'_> {
        token::TokenClient::new(&self.env, &self.token)
    }

    fn pubkey(&self) -> BytesN<32> {
        BytesN::from_array(&self.env, &self.signing_key.verifying_key().to_bytes())
    }

    fn deposit(&self, amount: i128) {
        self.client()
            .deposit(&self.sender, &self.token, &self.pubkey(), &amount);
    }

    fn sign_payload(
        &self,
        amount: i128,
        protocol_toll: i128,
        nonce: &BytesN<32>,
        receiver: &Address,
        gateway: &Address,
        bounty_relayer: &Option<Address>,
    ) -> BytesN<64> {
        let payload: Bytes = (
            amount,
            protocol_toll,
            nonce.clone(),
            receiver.clone(),
            gateway.clone(),
            bounty_relayer.clone(),
            self.token.clone(),
        )
            .to_xdr(&self.env);
        let payload_buffer = payload.to_buffer::<1024>();
        let signature = self.signing_key.sign(payload_buffer.as_slice()).to_bytes();

        BytesN::from_array(&self.env, &signature)
    }
}

fn setup_test() -> TestContext {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let gateway = Address::generate(&env);
    let receiver = Address::generate(&env);
    let relayer = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let token = token_id.address();

    let contract_id = env.register(PijinContract, (&admin, &treasury, &token));

    let signing_key = SigningKey::generate(&mut OsRng);
    let sender = Address::generate(&env);

    token::StellarAssetClient::new(&env, &token).mint(&sender, &INITIAL_BALANCE);

    let client = PijinContractClient::new(&env, &contract_id);
    client.register_gateway(&admin, &gateway);

    TestContext {
        env,
        contract_id,
        admin,
        treasury,
        gateway,
        receiver,
        relayer,
        sender,
        token,
        signing_key,
    }
}

#[test]
fn test_deposit_and_withdraw_success() {
    let ctx = setup_test();
    let token_client = ctx.token_client();

    ctx.deposit(DEPOSIT_AMOUNT);

    assert_eq!(
        token_client.balance(&ctx.sender),
        INITIAL_BALANCE - DEPOSIT_AMOUNT
    );
    assert_eq!(token_client.balance(&ctx.contract_id), DEPOSIT_AMOUNT);

    ctx.env
        .ledger()
        .with_mut(|ledger| ledger.timestamp += 86_401);
    ctx.client().withdraw(&ctx.sender, &ctx.token);

    assert_eq!(token_client.balance(&ctx.sender), INITIAL_BALANCE);
    assert_eq!(token_client.balance(&ctx.contract_id), 0);
}

#[test]
fn test_spend_offline_success_with_bounty() {
    let ctx = setup_test();
    let amount = 100_000_000;
    let protocol_toll = 5_000_000;
    let nonce = BytesN::from_array(&ctx.env, &[1; 32]);
    let bounty_relayer = Some(ctx.relayer.clone());
    let signature = ctx.sign_payload(
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver,
        &ctx.gateway,
        &bounty_relayer,
    );

    ctx.deposit(DEPOSIT_AMOUNT);
    ctx.client().spend_offline(
        &ctx.gateway,
        &ctx.sender,
        &ctx.token,
        &ctx.receiver,
        &bounty_relayer,
        &amount,
        &protocol_toll,
        &nonce,
        &signature,
    );

    let token_client = ctx.token_client();
    assert_eq!(token_client.balance(&ctx.receiver), amount);
    assert_eq!(token_client.balance(&ctx.treasury), protocol_toll);
    assert_eq!(token_client.balance(&ctx.relayer), BOUNTY_FEE);
    assert_eq!(
        token_client.balance(&ctx.contract_id),
        DEPOSIT_AMOUNT - amount - protocol_toll - BOUNTY_FEE
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
    let bounty_relayer = Some(ctx.relayer.clone());
    let signature = ctx.sign_payload(
        signed_amount,
        protocol_toll,
        &nonce,
        &ctx.receiver,
        &ctx.gateway,
        &bounty_relayer,
    );

    ctx.deposit(DEPOSIT_AMOUNT);
    ctx.client().spend_offline(
        &ctx.gateway,
        &ctx.sender,
        &ctx.token,
        &ctx.receiver,
        &bounty_relayer,
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
    let bounty_relayer = Some(ctx.relayer.clone());
    let signature = ctx.sign_payload(
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver,
        &ctx.gateway,
        &bounty_relayer,
    );

    ctx.deposit(DEPOSIT_AMOUNT);
    ctx.client().spend_offline(
        &ctx.gateway,
        &ctx.sender,
        &ctx.token,
        &ctx.receiver,
        &bounty_relayer,
        &amount,
        &protocol_toll,
        &nonce,
        &signature,
    );

    assert_eq!(
        ctx.client().try_spend_offline(
            &ctx.gateway,
            &ctx.sender,
            &ctx.token,
            &ctx.receiver,
            &bounty_relayer,
            &amount,
            &protocol_toll,
            &nonce,
            &signature,
        ),
        Err(Ok(ContractError::NonceReplayed))
    );
}

#[test]
fn test_withdraw_fails_timelock_active() {
    let ctx = setup_test();
    ctx.deposit(DEPOSIT_AMOUNT);

    assert_eq!(
        ctx.client().try_withdraw(&ctx.sender, &ctx.token),
        Err(Ok(ContractError::TimelockActive))
    );
}

#[test]
fn test_spend_offline_insufficient_balance() {
    let ctx = setup_test();
    let amount = 40;
    let protocol_toll = 1;
    let nonce = BytesN::from_array(&ctx.env, &[4; 32]);
    let bounty_relayer = Some(ctx.relayer.clone());
    let signature = ctx.sign_payload(
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver,
        &ctx.gateway,
        &bounty_relayer,
    );

    ctx.deposit(50);

    assert_eq!(
        ctx.client().try_spend_offline(
            &ctx.gateway,
            &ctx.sender,
            &ctx.token,
            &ctx.receiver,
            &bounty_relayer,
            &amount,
            &protocol_toll,
            &nonce,
            &signature,
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
    let bounty_relayer: Option<Address> = None;

    // Sign the payload as if the malicious gateway were legitimate.
    let signature = ctx.sign_payload(
        amount,
        protocol_toll,
        &nonce,
        &ctx.receiver,
        &malicious_gateway,
        &bounty_relayer,
    );

    ctx.deposit(DEPOSIT_AMOUNT);

    // The firewall must reject this before any business logic executes.
    assert_eq!(
        ctx.client().try_spend_offline(
            &malicious_gateway,
            &ctx.sender,
            &ctx.token,
            &ctx.receiver,
            &bounty_relayer,
            &amount,
            &protocol_toll,
            &nonce,
            &signature,
        ),
        Err(Ok(ContractError::NotWhitelistedGateway))
    );
}
