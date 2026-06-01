import { Buffer } from "buffer";
import { Client as ContractClient, Spec as ContractSpec, } from "@stellar/stellar-sdk/contract";
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
};
export class Client extends ContractClient {
    options;
    static async deploy(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options) {
        return ContractClient.deploy(null, options);
    }
    constructor(options) {
        super(new ContractSpec(["AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAwAAAAEAAAAAAAAABVZhdWx0AAAAAAAAAQAAABMAAAABAAAAAAAAAAVOb25jZQAAAAAAAAEAAAPuAAAAIAAAAAEAAAAAAAAACFRpbWVsb2NrAAAAAQAAABM=",
            "AAAABQAAAAAAAAAAAAAAClNwZW5kRXZlbnQAAAAAAAEAAAALc3BlbmRfZXZlbnQAAAAABAAAAAAAAAAIY3VzdG9tZXIAAAATAAAAAQAAAAAAAAAIbWVyY2hhbnQAAAATAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
            "AAAABQAAAAAAAAAAAAAADERlcG9zaXRFdmVudAAAAAEAAAANZGVwb3NpdF9ldmVudAAAAAAAAAMAAAAAAAAACGN1c3RvbWVyAAAAEwAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC",
            "AAAABQAAAAAAAAAAAAAADVdpdGhkcmF3RXZlbnQAAAAAAAABAAAADndpdGhkcmF3X2V2ZW50AAAAAAADAAAAAAAAAAhjdXN0b21lcgAAABMAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
            "AAAAAAAAAG5Vc2VyIGxvY2tzIGZ1bmRzIHdoaWxlIG9ubGluZS4KU2V0cyBhIDI0LWhvdXIgdGltZWxvY2sgdG8gZ3VhcmFudGVlIHRoZSBtZXJjaGFudCBoYXMgdGltZSB0byB0ZXh0IHRoZSByZWNlaXB0LgAAAAAAB2RlcG9zaXQAAAAAAwAAAAAAAAAIY3VzdG9tZXIAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=",
            "AAAAAAAAAElDdXN0b21lciB3aXRoZHJhd3MgcmVtYWluaW5nIGZ1bmRzIG9uY2UgdGhlIDI0LWhvdXIgZXNjcm93IHdpbmRvdyBjbG9zZXMuAAAAAAAACHdpdGhkcmF3AAAAAgAAAAAAAAAIY3VzdG9tZXIAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAA",
            "AAAAAAAAACVWaWV3IGZ1bmN0aW9uIGZvciBmcm9udGVuZCBkYXNoYm9hcmRzAAAAAAAACWdldF92YXVsdAAAAAAAAAEAAAAAAAAACGN1c3RvbWVyAAAAEwAAAAEAAAAL",
            "AAAAAAAAAEJUaGUgVHJ1c3RlZCBHYXRld2F5IChOZXh0LmpzKSBzdWJtaXRzIHRoZSBvZmZsaW5lIFNNUyB0cmFuc2FjdGlvbi4AAAAAAA1zcGVuZF9vZmZsaW5lAAAAAAAABwAAAAAAAAAHZ2F0ZXdheQAAAAATAAAAAAAAAAhjdXN0b21lcgAAABMAAAAAAAAACG1lcmNoYW50AAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAABW5vbmNlAAAAAAAD7gAAACAAAAAAAAAADWV4cGlyeV9sZWRnZXIAAAAAAAAEAAAAAA=="]), options);
        this.options = options;
    }
    fromJSON = {
        deposit: (this.txFromJSON),
        withdraw: (this.txFromJSON),
        get_vault: (this.txFromJSON),
        spend_offline: (this.txFromJSON)
    };
}
