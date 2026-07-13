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
    contractId: "CCGXMMXAYI4EHTGSH65ML3VK6TTRBQGT3BT2NN3P6Y3LGN6XIL2HILPX",
  }
} as const

/**
 * Typed storage keys for all contract state.
 * 
 * Instance storage:
 * - `Admin`: privileged account allowed to upgrade the contract.
 * - `Treasury`: protocol toll recipient.
 * - `Registrar`: narrowly-scoped backend signer allowed to manage short IDs.
 * 
 * Persistent storage:
 * - `Vault(Address, Address)`: per-user, per-token locked balance.
 * The tuple is `(UserAddress, TokenAddress)`, enabling the Omni-Vault
 * to hold and route any number of Stellar tokens simultaneously.
 * - `Nonce(BytesN<32>)`: replay protection for settled vouchers.
 * - `RegisteredKey(Address)`: user's offline Ed25519 key.
 * - `Gateway(Address)`: whitelisted relayer entry.
 * - `Recipient(BytesN<6>)`: case-sensitive Base62 short ID to wallet address.
 */
export type DataKey = {tag: "Admin", values: void} | {tag: "Treasury", values: void} | {tag: "Registrar", values: void} | {tag: "Vault", values: readonly [string, string]} | {tag: "Nonce", values: readonly [Buffer]} | {tag: "RegisteredKey", values: readonly [string]} | {tag: "Gateway", values: readonly [string]} | {tag: "Recipient", values: readonly [Buffer]};


export interface SpendEvent {
  amount: i128;
  balance: i128;
  gateway: string;
  nonce: Buffer;
  protocol_toll: i128;
  receiver: string;
  receiver_short_id: Buffer;
  sender: string;
  token: string;
}


export interface DepositEvent {
  amount: i128;
  balance: i128;
  sender: string;
  token: string;
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
  7: {message:"RecipientNotFound"},
  8: {message:"MathOverflow"},
  9: {message:"NotWhitelistedGateway"},
  10: {message:"ShortIdAlreadyRegistered"},
  11: {message:"RegistrarNotConfigured"},
  12: {message:"InvalidShortId"}
}


export interface WithdrawEvent {
  amount: i128;
  sender: string;
  token: string;
}


export interface RecipientEvent {
  receiver: string;
  short_id: Buffer;
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
  withdraw: ({sender, token, amount}: {sender: string, token: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_vault: ({user, token}: {user: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read the authoritative address for a short ID. TTL is extended by
   * state-changing registration and spend calls, not by this read helper.
   */
  get_recipient: ({short_id}: {short_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a get_registrar transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_registrar: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a set_registrar transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Assign the narrowly-scoped signer that is allowed to maintain the
   * short-ID registry. Only the contract admin can rotate this role.
   */
  set_registrar: ({admin, registrar}: {admin: string, registrar: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a spend_offline transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  spend_offline: ({gateway, sender, token, receiver_short_id, amount, protocol_toll, nonce, signature}: {gateway: string, sender: string, token: string, receiver_short_id: Buffer, amount: i128, protocol_toll: i128, nonce: Buffer, signature: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a remove_gateway transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove a previously whitelisted gateway relayer.
   * 
   * Only the stored admin may call this.
   */
  remove_gateway: ({admin, gateway}: {admin: string, gateway: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_offline_key transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read the key currently registered for a vault so clients can detect a
   * stale device registration before creating an SMS voucher.
   */
  get_offline_key: ({sender}: {sender: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<Buffer>>>

  /**
   * Construct and simulate a set_offline_key transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Rotate the Ed25519 key used for offline vouchers without requiring a
   * token deposit. Only the vault owner can authorize this change.
   */
  set_offline_key: ({sender, pubkey}: {sender: string, pubkey: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a register_gateway transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whitelist a gateway relayer address.
   * 
   * Only the stored admin may call this. The value written is a compact
   * boolean (`true`) to minimise ledger entry size.
   */
  register_gateway: ({admin, gateway}: {admin: string, gateway: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a update_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Explicitly rotate an existing short ID to a different wallet address.
   * This is deliberately separate from registration to prevent accidental
   * address replacement during retries.
   */
  update_recipient: ({registrar, short_id, receiver}: {registrar: string, short_id: Buffer, receiver: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a register_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register one canonical case-sensitive six-byte Base62 short ID.
   * Repeating the exact same mapping is idempotent and avoids another write.
   */
  register_recipient: ({registrar, short_id, receiver}: {registrar: string, short_id: Buffer, receiver: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, treasury}: {admin: string, treasury: string},
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
    return ContractClient.deploy({admin, treasury}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAHZGVwb3NpdAAAAAAEAAAAAAAAAAZzZW5kZXIAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAGcHVia2V5AAAAAAPuAAAAIAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAACJVcGdyYWRlIHRoZSBjdXJyZW50IGNvbnRyYWN0IFdBU00uAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAABAAAD6QAAA+0AAAAAAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAId2l0aGRyYXcAAAADAAAAAAAAAAZzZW5kZXIAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAJZ2V0X3ZhdWx0AAAAAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAAL",
        "AAAAAgAAArtUeXBlZCBzdG9yYWdlIGtleXMgZm9yIGFsbCBjb250cmFjdCBzdGF0ZS4KCkluc3RhbmNlIHN0b3JhZ2U6Ci0gYEFkbWluYDogcHJpdmlsZWdlZCBhY2NvdW50IGFsbG93ZWQgdG8gdXBncmFkZSB0aGUgY29udHJhY3QuCi0gYFRyZWFzdXJ5YDogcHJvdG9jb2wgdG9sbCByZWNpcGllbnQuCi0gYFJlZ2lzdHJhcmA6IG5hcnJvd2x5LXNjb3BlZCBiYWNrZW5kIHNpZ25lciBhbGxvd2VkIHRvIG1hbmFnZSBzaG9ydCBJRHMuCgpQZXJzaXN0ZW50IHN0b3JhZ2U6Ci0gYFZhdWx0KEFkZHJlc3MsIEFkZHJlc3MpYDogcGVyLXVzZXIsIHBlci10b2tlbiBsb2NrZWQgYmFsYW5jZS4KVGhlIHR1cGxlIGlzIGAoVXNlckFkZHJlc3MsIFRva2VuQWRkcmVzcylgLCBlbmFibGluZyB0aGUgT21uaS1WYXVsdAp0byBob2xkIGFuZCByb3V0ZSBhbnkgbnVtYmVyIG9mIFN0ZWxsYXIgdG9rZW5zIHNpbXVsdGFuZW91c2x5LgotIGBOb25jZShCeXRlc048MzI+KWA6IHJlcGxheSBwcm90ZWN0aW9uIGZvciBzZXR0bGVkIHZvdWNoZXJzLgotIGBSZWdpc3RlcmVkS2V5KEFkZHJlc3MpYDogdXNlcidzIG9mZmxpbmUgRWQyNTUxOSBrZXkuCi0gYEdhdGV3YXkoQWRkcmVzcylgOiB3aGl0ZWxpc3RlZCByZWxheWVyIGVudHJ5LgotIGBSZWNpcGllbnQoQnl0ZXNOPDY+KWA6IGNhc2Utc2Vuc2l0aXZlIEJhc2U2MiBzaG9ydCBJRCB0byB3YWxsZXQgYWRkcmVzcy4AAAAAAAAAAAdEYXRhS2V5AAAAAAgAAAAAAAAAAAAAAAVBZG1pbgAAAAAAAAAAAAAAAAAACFRyZWFzdXJ5AAAAAAAAAAAAAAAJUmVnaXN0cmFyAAAAAAAAAQAAAAAAAAAFVmF1bHQAAAAAAAACAAAAEwAAABMAAAABAAAAAAAAAAVOb25jZQAAAAAAAAEAAAPuAAAAIAAAAAEAAAAAAAAADVJlZ2lzdGVyZWRLZXkAAAAAAAABAAAAEwAAAAEAAAAAAAAAB0dhdGV3YXkAAAAAAQAAABMAAAABAAAAAAAAAAlSZWNpcGllbnQAAAAAAAABAAAD7gAAAAY=",
        "AAAAAQAAAAAAAAAAAAAAClNwZW5kRXZlbnQAAAAAAAkAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAHYmFsYW5jZQAAAAALAAAAAAAAAAdnYXRld2F5AAAAABMAAAAAAAAABW5vbmNlAAAAAAAD7gAAACAAAAAAAAAADXByb3RvY29sX3RvbGwAAAAAAAALAAAAAAAAAAhyZWNlaXZlcgAAABMAAAAAAAAAEXJlY2VpdmVyX3Nob3J0X2lkAAAAAAAD7gAAAAYAAAAAAAAABnNlbmRlcgAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAAT",
        "AAAAAAAAAIdSZWFkIHRoZSBhdXRob3JpdGF0aXZlIGFkZHJlc3MgZm9yIGEgc2hvcnQgSUQuIFRUTCBpcyBleHRlbmRlZCBieQpzdGF0ZS1jaGFuZ2luZyByZWdpc3RyYXRpb24gYW5kIHNwZW5kIGNhbGxzLCBub3QgYnkgdGhpcyByZWFkIGhlbHBlci4AAAAADWdldF9yZWNpcGllbnQAAAAAAAABAAAAAAAAAAhzaG9ydF9pZAAAA+4AAAAGAAAAAQAAA+gAAAAT",
        "AAAAAAAAAAAAAAANZ2V0X3JlZ2lzdHJhcgAAAAAAAAAAAAABAAAD6AAAABM=",
        "AAAAAAAAAIJBc3NpZ24gdGhlIG5hcnJvd2x5LXNjb3BlZCBzaWduZXIgdGhhdCBpcyBhbGxvd2VkIHRvIG1haW50YWluIHRoZQpzaG9ydC1JRCByZWdpc3RyeS4gT25seSB0aGUgY29udHJhY3QgYWRtaW4gY2FuIHJvdGF0ZSB0aGlzIHJvbGUuAAAAAAANc2V0X3JlZ2lzdHJhcgAAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAJcmVnaXN0cmFyAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAANc3BlbmRfb2ZmbGluZQAAAAAAAAgAAAAAAAAAB2dhdGV3YXkAAAAAEwAAAAAAAAAGc2VuZGVyAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAAEXJlY2VpdmVyX3Nob3J0X2lkAAAAAAAD7gAAAAYAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAANcHJvdG9jb2xfdG9sbAAAAAAAAAsAAAAAAAAABW5vbmNlAAAAAAAD7gAAACAAAAAAAAAACXNpZ25hdHVyZQAAAAAAA+4AAABAAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAYRQcm90b2NvbCAyMiBjb25zdHJ1Y3Rvci4KCkluaXRpYWxpc2VzIHRoZSBPbW5pLVZhdWx0IHdpdGggb25seSB0aGUgYEFkbWluYCBhbmQgYFRyZWFzdXJ5YAphZGRyZXNzZXMuIE5vIHRva2VuIGlzIGxvY2tlZCBhdCB0aGUgY29udHJhY3QgbGV2ZWwg4oCUIHN1cHBvcnRlZCBhc3NldHMKYXJlIGRldGVybWluZWQgZHluYW1pY2FsbHkgcGVyIHZhdWx0IGVudHJ5IChgRGF0YUtleTo6VmF1bHQodXNlciwgdG9rZW4pYCkuCgpDb25zdHJ1Y3RvciBleGVjdXRpb24gaXMgZXhwZWN0ZWQgb25seSBvbmNlLCBidXQgdGhlIGd1YXJkIGtlZXBzIHRlc3RzCmFuZCBhbnkgZnV0dXJlIGNvbXBhdGliaWxpdHkgcGF0aCBmcm9tIHNpbGVudGx5IG92ZXJ3cml0aW5nIHByaXZpbGVnZWQgc3RhdGUuAAAADV9fY29uc3RydWN0b3IAAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACHRyZWFzdXJ5AAAAEwAAAAA=",
        "AAAAAAAAAFZSZW1vdmUgYSBwcmV2aW91c2x5IHdoaXRlbGlzdGVkIGdhdGV3YXkgcmVsYXllci4KCk9ubHkgdGhlIHN0b3JlZCBhZG1pbiBtYXkgY2FsbCB0aGlzLgAAAAAADnJlbW92ZV9nYXRld2F5AAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAB2dhdGV3YXkAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAQAAAAAAAAAAAAAADERlcG9zaXRFdmVudAAAAAQAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAHYmFsYW5jZQAAAAALAAAAAAAAAAZzZW5kZXIAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEw==",
        "AAAAAAAAAH9SZWFkIHRoZSBrZXkgY3VycmVudGx5IHJlZ2lzdGVyZWQgZm9yIGEgdmF1bHQgc28gY2xpZW50cyBjYW4gZGV0ZWN0IGEKc3RhbGUgZGV2aWNlIHJlZ2lzdHJhdGlvbiBiZWZvcmUgY3JlYXRpbmcgYW4gU01TIHZvdWNoZXIuAAAAAA9nZXRfb2ZmbGluZV9rZXkAAAAAAQAAAAAAAAAGc2VuZGVyAAAAAAATAAAAAQAAA+gAAAPuAAAAIA==",
        "AAAAAAAAAINSb3RhdGUgdGhlIEVkMjU1MTkga2V5IHVzZWQgZm9yIG9mZmxpbmUgdm91Y2hlcnMgd2l0aG91dCByZXF1aXJpbmcgYQp0b2tlbiBkZXBvc2l0LiBPbmx5IHRoZSB2YXVsdCBvd25lciBjYW4gYXV0aG9yaXplIHRoaXMgY2hhbmdlLgAAAAAPc2V0X29mZmxpbmVfa2V5AAAAAAIAAAAAAAAABnNlbmRlcgAAAAAAEwAAAAAAAAAGcHVia2V5AAAAAAPuAAAAIAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAABAAAAChTdGFibGUsIGNsaWVudC1yZWFkYWJsZSBjb250cmFjdCBlcnJvcnMuAAAAAAAAAA1Db250cmFjdEVycm9yAAAAAAAADAAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAAxVbmF1dGhvcml6ZWQAAAACAAAAAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAAAwAAAAAAAAAORXhwaXJlZFZvdWNoZXIAAAAAAAQAAAAAAAAADU5vbmNlUmVwbGF5ZWQAAAAAAAAFAAAAAAAAABNJbnN1ZmZpY2llbnRCYWxhbmNlAAAAAAYAAAAAAAAAEVJlY2lwaWVudE5vdEZvdW5kAAAAAAAABwAAAAAAAAAMTWF0aE92ZXJmbG93AAAACAAAAAAAAAAVTm90V2hpdGVsaXN0ZWRHYXRld2F5AAAAAAAACQAAAAAAAAAYU2hvcnRJZEFscmVhZHlSZWdpc3RlcmVkAAAACgAAAAAAAAAWUmVnaXN0cmFyTm90Q29uZmlndXJlZAAAAAAACwAAAAAAAAAOSW52YWxpZFNob3J0SWQAAAAAAAw=",
        "AAAAAQAAAAAAAAAAAAAADVdpdGhkcmF3RXZlbnQAAAAAAAADAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAABnNlbmRlcgAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAAT",
        "AAAAAAAAAJlXaGl0ZWxpc3QgYSBnYXRld2F5IHJlbGF5ZXIgYWRkcmVzcy4KCk9ubHkgdGhlIHN0b3JlZCBhZG1pbiBtYXkgY2FsbCB0aGlzLiBUaGUgdmFsdWUgd3JpdHRlbiBpcyBhIGNvbXBhY3QKYm9vbGVhbiAoYHRydWVgKSB0byBtaW5pbWlzZSBsZWRnZXIgZW50cnkgc2l6ZS4AAAAAAAAQcmVnaXN0ZXJfZ2F0ZXdheQAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAHZ2F0ZXdheQAAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAK9FeHBsaWNpdGx5IHJvdGF0ZSBhbiBleGlzdGluZyBzaG9ydCBJRCB0byBhIGRpZmZlcmVudCB3YWxsZXQgYWRkcmVzcy4KVGhpcyBpcyBkZWxpYmVyYXRlbHkgc2VwYXJhdGUgZnJvbSByZWdpc3RyYXRpb24gdG8gcHJldmVudCBhY2NpZGVudGFsCmFkZHJlc3MgcmVwbGFjZW1lbnQgZHVyaW5nIHJldHJpZXMuAAAAABB1cGRhdGVfcmVjaXBpZW50AAAAAwAAAAAAAAAJcmVnaXN0cmFyAAAAAAAAEwAAAAAAAAAIc2hvcnRfaWQAAAPuAAAABgAAAAAAAAAIcmVjZWl2ZXIAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAQAAAAAAAAAAAAAADlJlY2lwaWVudEV2ZW50AAAAAAACAAAAAAAAAAhyZWNlaXZlcgAAABMAAAAAAAAACHNob3J0X2lkAAAD7gAAAAY=",
        "AAAAAAAAAIhSZWdpc3RlciBvbmUgY2Fub25pY2FsIGNhc2Utc2Vuc2l0aXZlIHNpeC1ieXRlIEJhc2U2MiBzaG9ydCBJRC4KUmVwZWF0aW5nIHRoZSBleGFjdCBzYW1lIG1hcHBpbmcgaXMgaWRlbXBvdGVudCBhbmQgYXZvaWRzIGFub3RoZXIgd3JpdGUuAAAAEnJlZ2lzdGVyX3JlY2lwaWVudAAAAAAAAwAAAAAAAAAJcmVnaXN0cmFyAAAAAAAAEwAAAAAAAAAIc2hvcnRfaWQAAAPuAAAABgAAAAAAAAAIcmVjZWl2ZXIAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    deposit: this.txFromJSON<Result<void>>,
        upgrade: this.txFromJSON<Result<void>>,
        withdraw: this.txFromJSON<Result<void>>,
        get_vault: this.txFromJSON<i128>,
        get_recipient: this.txFromJSON<Option<string>>,
        get_registrar: this.txFromJSON<Option<string>>,
        set_registrar: this.txFromJSON<Result<void>>,
        spend_offline: this.txFromJSON<Result<void>>,
        remove_gateway: this.txFromJSON<Result<void>>,
        get_offline_key: this.txFromJSON<Option<Buffer>>,
        set_offline_key: this.txFromJSON<Result<void>>,
        register_gateway: this.txFromJSON<Result<void>>,
        update_recipient: this.txFromJSON<Result<void>>,
        register_recipient: this.txFromJSON<Result<void>>
  }
}