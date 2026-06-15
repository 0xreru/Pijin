import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CCIYHL76UBBEOO3QNH775POWFQKYQ5U6IZEMZFHBSNYAU73EE64IXQZF",
  }
} as const

/**
 * Typed storage keys for all contract state.
 * 
 * Instance storage:
 * - `Admin`: privileged account allowed to upgrade the contract.
 * - `Treasury`: protocol toll recipient.
 * - `Token`: official accepted asset contract.
 * 
 * Persistent storage:
 * - `Vault(Address, Address)`: user locked balance by token.
 * - `Nonce(BytesN<32>)`: replay protection for settled vouchers.
 * - `Timelock(Address)`: user withdrawal delay.
 * - `RegisteredKey(Address)`: user's offline Ed25519 key.
 */
export type DataKey = {tag: "Admin", values: void} | {tag: "Treasury", values: void} | {tag: "Token", values: void} | {tag: "Vault", values: readonly [string, string]} | {tag: "Nonce", values: readonly [Buffer]} | {tag: "Timelock", values: readonly [string]} | {tag: "RegisteredKey", values: readonly [string]} | {tag: "Gateway", values: readonly [string]};


export interface SpendEvent {
  amount: i128;
  balance: i128;
  bounty_fee: i128;
  bounty_relayer: Option<string>;
  gateway: string;
  nonce: Buffer;
  protocol_toll: i128;
  receiver: string;
  sender: string;
  token: string;
}


export interface DepositEvent {
  amount: i128;
  balance: i128;
  sender: string;
  token: string;
  unlock_time: u64;
}

/**
 * Stable, client-readable contract errors.
 */
export const ContractError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"Unauthorized"},
  3: {message:"InvalidAmount"},
  4: {message:"ExpiredVoucher"},
  5: {message:"NonceReplayed"},
  6: {message:"InsufficientBalance"},
  7: {message:"TimelockActive"},
  8: {message:"MathOverflow"},
  9: {message:"NotWhitelistedGateway"}
}


export interface WithdrawEvent {
  amount: i128;
  sender: string;
  token: string;
}

export interface Client {
  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit: ({sender, token, pubkey, amount}: {sender: string, token: string, pubkey: Buffer, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Upgrade the current contract WASM.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  withdraw: ({sender, token}: {sender: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_vault: ({user, token}: {user: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a spend_offline transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  spend_offline: ({gateway, sender, token, receiver, bounty_relayer, amount, protocol_toll, nonce, signature}: {gateway: string, sender: string, token: string, receiver: string, bounty_relayer: Option<string>, amount: i128, protocol_toll: i128, nonce: Buffer, signature: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a remove_gateway transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove a previously whitelisted gateway relayer.
   * 
   * Only the stored admin may call this.
   */
  remove_gateway: ({admin, gateway}: {admin: string, gateway: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a register_gateway transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whitelist a gateway relayer address.
   * 
   * Only the stored admin may call this. The value written is a compact
   * boolean (`true`) to minimise ledger entry size.
   */
  register_gateway: ({admin, gateway}: {admin: string, gateway: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, treasury, token}: {admin: string, treasury: string, token: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, treasury, token}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAHZGVwb3NpdAAAAAAEAAAAAAAAAAZzZW5kZXIAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAGcHVia2V5AAAAAAPuAAAAIAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAACJVcGdyYWRlIHRoZSBjdXJyZW50IGNvbnRyYWN0IFdBU00uAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAABAAAD6QAAA+0AAAAAAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAId2l0aGRyYXcAAAACAAAAAAAAAAZzZW5kZXIAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAJZ2V0X3ZhdWx0AAAAAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAAL",
        "AAAAAgAAAcVUeXBlZCBzdG9yYWdlIGtleXMgZm9yIGFsbCBjb250cmFjdCBzdGF0ZS4KCkluc3RhbmNlIHN0b3JhZ2U6Ci0gYEFkbWluYDogcHJpdmlsZWdlZCBhY2NvdW50IGFsbG93ZWQgdG8gdXBncmFkZSB0aGUgY29udHJhY3QuCi0gYFRyZWFzdXJ5YDogcHJvdG9jb2wgdG9sbCByZWNpcGllbnQuCi0gYFRva2VuYDogb2ZmaWNpYWwgYWNjZXB0ZWQgYXNzZXQgY29udHJhY3QuCgpQZXJzaXN0ZW50IHN0b3JhZ2U6Ci0gYFZhdWx0KEFkZHJlc3MsIEFkZHJlc3MpYDogdXNlciBsb2NrZWQgYmFsYW5jZSBieSB0b2tlbi4KLSBgTm9uY2UoQnl0ZXNOPDMyPilgOiByZXBsYXkgcHJvdGVjdGlvbiBmb3Igc2V0dGxlZCB2b3VjaGVycy4KLSBgVGltZWxvY2soQWRkcmVzcylgOiB1c2VyIHdpdGhkcmF3YWwgZGVsYXkuCi0gYFJlZ2lzdGVyZWRLZXkoQWRkcmVzcylgOiB1c2VyJ3Mgb2ZmbGluZSBFZDI1NTE5IGtleS4AAAAAAAAAAAAAB0RhdGFLZXkAAAAACAAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAIVHJlYXN1cnkAAAAAAAAAAAAAAAVUb2tlbgAAAAAAAAEAAAAAAAAABVZhdWx0AAAAAAAAAgAAABMAAAATAAAAAQAAAAAAAAAFTm9uY2UAAAAAAAABAAAD7gAAACAAAAABAAAAAAAAAAhUaW1lbG9jawAAAAEAAAATAAAAAQAAAAAAAAANUmVnaXN0ZXJlZEtleQAAAAAAAAEAAAATAAAAAQAAAAAAAAAHR2F0ZXdheQAAAAABAAAAEw==",
        "AAAAAQAAAAAAAAAAAAAAClNwZW5kRXZlbnQAAAAAAAoAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAHYmFsYW5jZQAAAAALAAAAAAAAAApib3VudHlfZmVlAAAAAAALAAAAAAAAAA5ib3VudHlfcmVsYXllcgAAAAAD6AAAABMAAAAAAAAAB2dhdGV3YXkAAAAAEwAAAAAAAAAFbm9uY2UAAAAAAAPuAAAAIAAAAAAAAAANcHJvdG9jb2xfdG9sbAAAAAAAAAsAAAAAAAAACHJlY2VpdmVyAAAAEwAAAAAAAAAGc2VuZGVyAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABM=",
        "AAAAAAAAAAAAAAANc3BlbmRfb2ZmbGluZQAAAAAAAAkAAAAAAAAAB2dhdGV3YXkAAAAAEwAAAAAAAAAGc2VuZGVyAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAACHJlY2VpdmVyAAAAEwAAAAAAAAAOYm91bnR5X3JlbGF5ZXIAAAAAA+gAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAADXByb3RvY29sX3RvbGwAAAAAAAALAAAAAAAAAAVub25jZQAAAAAAA+4AAAAgAAAAAAAAAAlzaWduYXR1cmUAAAAAAAPuAAAAQAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAK5Qcm90b2NvbCAyMiBjb25zdHJ1Y3Rvci4KCkNvbnN0cnVjdG9yIGV4ZWN1dGlvbiBpcyBleHBlY3RlZCBvbmx5IG9uY2UsIGJ1dCB0aGUgZ3VhcmQga2VlcHMgdGVzdHMgYW5kCmFueSBmdXR1cmUgY29tcGF0aWJpbGl0eSBwYXRoIGZyb20gc2lsZW50bHkgb3ZlcndyaXRpbmcgcHJpdmlsZWdlZCBzdGF0ZS4AAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAh0cmVhc3VyeQAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAA=",
        "AAAAAAAAAFZSZW1vdmUgYSBwcmV2aW91c2x5IHdoaXRlbGlzdGVkIGdhdGV3YXkgcmVsYXllci4KCk9ubHkgdGhlIHN0b3JlZCBhZG1pbiBtYXkgY2FsbCB0aGlzLgAAAAAADnJlbW92ZV9nYXRld2F5AAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAB2dhdGV3YXkAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAQAAAAAAAAAAAAAADERlcG9zaXRFdmVudAAAAAUAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAHYmFsYW5jZQAAAAALAAAAAAAAAAZzZW5kZXIAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAALdW5sb2NrX3RpbWUAAAAABg==",
        "AAAABAAAAChTdGFibGUsIGNsaWVudC1yZWFkYWJsZSBjb250cmFjdCBlcnJvcnMuAAAAAAAAAA1Db250cmFjdEVycm9yAAAAAAAACQAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAAxVbmF1dGhvcml6ZWQAAAACAAAAAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAAAwAAAAAAAAAORXhwaXJlZFZvdWNoZXIAAAAAAAQAAAAAAAAADU5vbmNlUmVwbGF5ZWQAAAAAAAAFAAAAAAAAABNJbnN1ZmZpY2llbnRCYWxhbmNlAAAAAAYAAAAAAAAADlRpbWVsb2NrQWN0aXZlAAAAAAAHAAAAAAAAAAxNYXRoT3ZlcmZsb3cAAAAIAAAAAAAAABVOb3RXaGl0ZWxpc3RlZEdhdGV3YXkAAAAAAAAJ",
        "AAAAAQAAAAAAAAAAAAAADVdpdGhkcmF3RXZlbnQAAAAAAAADAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAABnNlbmRlcgAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAAT",
        "AAAAAAAAAJlXaGl0ZWxpc3QgYSBnYXRld2F5IHJlbGF5ZXIgYWRkcmVzcy4KCk9ubHkgdGhlIHN0b3JlZCBhZG1pbiBtYXkgY2FsbCB0aGlzLiBUaGUgdmFsdWUgd3JpdHRlbiBpcyBhIGNvbXBhY3QKYm9vbGVhbiAoYHRydWVgKSB0byBtaW5pbWlzZSBsZWRnZXIgZW50cnkgc2l6ZS4AAAAAAAAQcmVnaXN0ZXJfZ2F0ZXdheQAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAHZ2F0ZXdheQAAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    deposit: this.txFromJSON<Result<void>>,
        upgrade: this.txFromJSON<Result<void>>,
        withdraw: this.txFromJSON<Result<void>>,
        get_vault: this.txFromJSON<i128>,
        spend_offline: this.txFromJSON<Result<void>>,
        remove_gateway: this.txFromJSON<Result<void>>,
        register_gateway: this.txFromJSON<Result<void>>
  }
}