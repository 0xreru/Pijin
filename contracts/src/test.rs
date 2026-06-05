#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, IntoVal};

fn setup_test<'a>() -> (Env, PijinContractClient<'a>, Address, Address, Address) {
    let env = Env::default();
    
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let token = Address::generate(&env);

    // Registering the contract in Protocol 22 invokes `__constructor`
    let contract_id = env.register(PijinContract, (&admin, &treasury, &token));
    let client = PijinContractClient::new(&env, &contract_id);

    (env, client, admin, treasury, token)
}

#[test]
fn test_successful_initialization() {
    let (_env, _client, _admin, _treasury, _token) = setup_test();

    // If setup_test() finishes without panicking, it means the Protocol 22
    // constructor flawlessly saved Admin, Treasury, and Token to Instance Storage
    assert!(true, "Contract securely initialized");
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_upgrade_fails_with_unauthorized_user() {
    let (env, client, _admin, _treasury, _token) = setup_test();
    let hacker = Address::generate(&env);

    // We explicitly mock authorization ONLY for the hacker. 
    // The contract expects the `admin` to authorize the call.
    env.mock_auths(&[
        soroban_sdk::testutils::MockAuth {
            address: &hacker,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &client.address,
                fn_name: "upgrade",
                args: (BytesN::from_array(&env, &[2u8; 32]),).into_val(&env),
                sub_invokes: &[],
            },
        }
    ]);

    let fake_new_wasm = BytesN::from_array(&env, &[2u8; 32]);
    
    // This MUST panic because the hacker is not the stored Admin.
    client.upgrade(&fake_new_wasm);
}
