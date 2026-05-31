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
  unknown: {
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    contractId: "CCJUISYGMTZUMFGOBZI5BTXWR37I6FGE37BCZFVDXNXAK4BFOPAXKI6W",
  }
} as const

export type DataKey = {tag: "Vault", values: readonly [string]} | {tag: "Nonce", values: readonly [Buffer]} | {tag: "Timelock", values: readonly [string]};




export interface Client {
  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * User locks funds while online.
   * Sets a 24-hour timelock to guarantee the merchant has time to text the receipt.
   */
  deposit: ({customer, token, amount}: {customer: string, token: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Customer withdraws remaining funds once the 24-hour escrow window closes.
   */
  withdraw: ({customer, token}: {customer: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * View function for frontend dashboards
   */
  get_vault: ({customer}: {customer: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a spend_offline transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The Trusted Gateway (Next.js) submits the offline SMS transaction.
   */
  spend_offline: ({gateway, customer, merchant, token, amount, nonce, expiry_ledger}: {gateway: string, customer: string, merchant: string, token: string, amount: i128, nonce: Buffer, expiry_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
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
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAwAAAAEAAAAAAAAABVZhdWx0AAAAAAAAAQAAABMAAAABAAAAAAAAAAVOb25jZQAAAAAAAAEAAAPuAAAAIAAAAAEAAAAAAAAACFRpbWVsb2NrAAAAAQAAABM=",
        "AAAABQAAAAAAAAAAAAAAClNwZW5kRXZlbnQAAAAAAAEAAAALc3BlbmRfZXZlbnQAAAAABAAAAAAAAAAIY3VzdG9tZXIAAAATAAAAAQAAAAAAAAAIbWVyY2hhbnQAAAATAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADERlcG9zaXRFdmVudAAAAAEAAAANZGVwb3NpdF9ldmVudAAAAAAAAAMAAAAAAAAACGN1c3RvbWVyAAAAEwAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADVdpdGhkcmF3RXZlbnQAAAAAAAABAAAADndpdGhkcmF3X2V2ZW50AAAAAAADAAAAAAAAAAhjdXN0b21lcgAAABMAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAAAAAAAG5Vc2VyIGxvY2tzIGZ1bmRzIHdoaWxlIG9ubGluZS4KU2V0cyBhIDI0LWhvdXIgdGltZWxvY2sgdG8gZ3VhcmFudGVlIHRoZSBtZXJjaGFudCBoYXMgdGltZSB0byB0ZXh0IHRoZSByZWNlaXB0LgAAAAAAB2RlcG9zaXQAAAAAAwAAAAAAAAAIY3VzdG9tZXIAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=",
        "AAAAAAAAAElDdXN0b21lciB3aXRoZHJhd3MgcmVtYWluaW5nIGZ1bmRzIG9uY2UgdGhlIDI0LWhvdXIgZXNjcm93IHdpbmRvdyBjbG9zZXMuAAAAAAAACHdpdGhkcmF3AAAAAgAAAAAAAAAIY3VzdG9tZXIAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAA",
        "AAAAAAAAACVWaWV3IGZ1bmN0aW9uIGZvciBmcm9udGVuZCBkYXNoYm9hcmRzAAAAAAAACWdldF92YXVsdAAAAAAAAAEAAAAAAAAACGN1c3RvbWVyAAAAEwAAAAEAAAAL",
        "AAAAAAAAAEJUaGUgVHJ1c3RlZCBHYXRld2F5IChOZXh0LmpzKSBzdWJtaXRzIHRoZSBvZmZsaW5lIFNNUyB0cmFuc2FjdGlvbi4AAAAAAA1zcGVuZF9vZmZsaW5lAAAAAAAABwAAAAAAAAAHZ2F0ZXdheQAAAAATAAAAAAAAAAhjdXN0b21lcgAAABMAAAAAAAAACG1lcmNoYW50AAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAABW5vbmNlAAAAAAAD7gAAACAAAAAAAAAADWV4cGlyeV9sZWRnZXIAAAAAAAAEAAAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    deposit: this.txFromJSON<null>,
        withdraw: this.txFromJSON<null>,
        get_vault: this.txFromJSON<i128>,
        spend_offline: this.txFromJSON<null>
  }
}