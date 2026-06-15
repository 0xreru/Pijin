import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions, Result } from "@stellar/stellar-sdk/contract";
import type { i128 } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export declare const networks: {
    readonly testnet: {
        readonly networkPassphrase: "Test SDF Network ; September 2015";
        readonly contractId: "CDDKYJFFAKTXDZ7ZDGHFNG6M4FB2WLYD6DRRPJ5W5LKNQ64LVMYNI6K4";
    };
};
/**
 * Typed storage keys for all contract state.
 *
 * Instance storage:
 * - `Admin`: privileged account allowed to upgrade the contract.
 * - `Treasury`: protocol toll recipient.
 *
 * Persistent storage:
 * - `Vault(Address, Address)`: per-user, per-token locked balance.
 * The tuple is `(UserAddress, TokenAddress)`, enabling the Omni-Vault
 * to hold and route any number of Stellar tokens simultaneously.
 * - `Nonce(BytesN<32>)`: replay protection for settled vouchers.
 * - `RegisteredKey(Address)`: user's offline Ed25519 key.
 * - `Gateway(Address)`: whitelisted relayer entry.
 */
export type DataKey = {
    tag: "Admin";
    values: void;
} | {
    tag: "Treasury";
    values: void;
} | {
    tag: "Vault";
    values: readonly [string, string];
} | {
    tag: "Nonce";
    values: readonly [Buffer];
} | {
    tag: "RegisteredKey";
    values: readonly [string];
} | {
    tag: "Gateway";
    values: readonly [string];
};
export interface SpendEvent {
    amount: i128;
    balance: i128;
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
}
/**
 * Stable, client-readable contract errors.
 */
export declare const ContractError: {
    1: {
        message: string;
    };
    2: {
        message: string;
    };
    3: {
        message: string;
    };
    4: {
        message: string;
    };
    5: {
        message: string;
    };
    6: {
        message: string;
    };
    8: {
        message: string;
    };
    9: {
        message: string;
    };
};
export interface WithdrawEvent {
    amount: i128;
    sender: string;
    token: string;
}
export interface Client {
    /**
     * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    deposit: ({ sender, token, pubkey, amount }: {
        sender: string;
        token: string;
        pubkey: Buffer;
        amount: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Upgrade the current contract WASM.
     */
    upgrade: ({ new_wasm_hash }: {
        new_wasm_hash: Buffer;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    withdraw: ({ sender, token }: {
        sender: string;
        token: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a get_vault transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_vault: ({ user, token }: {
        user: string;
        token: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a spend_offline transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    spend_offline: ({ gateway, sender, token, receiver, amount, protocol_toll, nonce, signature }: {
        gateway: string;
        sender: string;
        token: string;
        receiver: string;
        amount: i128;
        protocol_toll: i128;
        nonce: Buffer;
        signature: Buffer;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a remove_gateway transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Remove a previously whitelisted gateway relayer.
     *
     * Only the stored admin may call this.
     */
    remove_gateway: ({ admin, gateway }: {
        admin: string;
        gateway: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a register_gateway transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Whitelist a gateway relayer address.
     *
     * Only the stored admin may call this. The value written is a compact
     * boolean (`true`) to minimise ledger entry size.
     */
    register_gateway: ({ admin, gateway }: {
        admin: string;
        gateway: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
}
export declare class Client extends ContractClient {
    readonly options: ContractClientOptions;
    static deploy<T = Client>(
    /** Constructor/Initialization Args for the contract's `__constructor` method */
    { admin, treasury }: {
        admin: string;
        treasury: string;
    }, 
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
        deposit: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        upgrade: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        withdraw: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        get_vault: (json: string) => AssembledTransaction<bigint>;
        spend_offline: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        remove_gateway: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        register_gateway: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
    };
}
