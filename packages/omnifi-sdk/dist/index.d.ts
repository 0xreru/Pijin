import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions } from "@stellar/stellar-sdk/contract";
import type { u32, i128 } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export declare const networks: {
    readonly unknown: {
        readonly networkPassphrase: "Public Global Stellar Network ; September 2015";
        readonly contractId: "CCJUISYGMTZUMFGOBZI5BTXWR37I6FGE37BCZFVDXNXAK4BFOPAXKI6W";
    };
};
export type DataKey = {
    tag: "Vault";
    values: readonly [string];
} | {
    tag: "Nonce";
    values: readonly [Buffer];
} | {
    tag: "Timelock";
    values: readonly [string];
};
export interface Client {
    /**
     * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * User locks funds while online.
     * Sets a 24-hour timelock to guarantee the merchant has time to text the receipt.
     */
    deposit: ({ customer, token, amount }: {
        customer: string;
        token: string;
        amount: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Customer withdraws remaining funds once the 24-hour escrow window closes.
     */
    withdraw: ({ customer, token }: {
        customer: string;
        token: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a get_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * View function for frontend dashboards
     */
    get_vault: ({ customer }: {
        customer: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a spend_offline transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * The Trusted Gateway (Next.js) submits the offline SMS transaction.
     */
    spend_offline: ({ gateway, customer, merchant, token, amount, nonce, expiry_ledger }: {
        gateway: string;
        customer: string;
        merchant: string;
        token: string;
        amount: i128;
        nonce: Buffer;
        expiry_ledger: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
}
export declare class Client extends ContractClient {
    readonly options: ContractClientOptions;
    static deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions & Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
    }): Promise<AssembledTransaction<T>>;
    constructor(options: ContractClientOptions);
    readonly fromJSON: {
        deposit: (json: string) => AssembledTransaction<null>;
        withdraw: (json: string) => AssembledTransaction<null>;
        get_vault: (json: string) => AssembledTransaction<bigint>;
        spend_offline: (json: string) => AssembledTransaction<null>;
    };
}
