import { Keypair } from '@stellar/stellar-sdk';

/**
 * Mathematically restores the '=' padding to a Base64 string
 * because we stripped them on the React Native side to save SMS characters.
 */
export function restoreBase64Padding(base64Str: string): string {
    const paddingNeeded = (4 - (base64Str.length % 4)) % 4;
    return base64Str + '='.repeat(paddingNeeded);
}

/**
 * Takes the 8-byte compressed nonce from the SMS and expands it 
 * back to the 32-byte Buffer that the Soroban Smart Contract requires.
 */
export function expandNonce(shortNonceB64: string): Buffer {
    // Decode the Base64 into an 8-byte Buffer
    const shortBuffer = Buffer.from(restoreBase64Padding(shortNonceB64), 'base64');
    
    // Create an empty 32-byte Buffer (filled with zeros)
    const fullNonce32 = Buffer.alloc(32);
    
    // Copy the 8 bytes into the start of the 32-byte buffer
    shortBuffer.copy(fullNonce32);
    
    return fullNonce32;
}

/**
 * Cryptographically verifies the Ed25519 signature locally in Next.js
 * BEFORE we waste gas fees submitting it to the Stellar Network.
 */
export function verifySignatureLocally(
    customerPublicKey: string, 
    expectedSignedData: string, 
    signatureB64: string
): boolean {
    try {
        const customerKeypair = Keypair.fromPublicKey(customerPublicKey);
        const signatureBuffer = Buffer.from(restoreBase64Padding(signatureB64), 'base64');
        
        return customerKeypair.verify(
            Buffer.from(expectedSignedData),
            signatureBuffer
        );
    } catch (error) {
        console.error("Cryptography Verification Error:", error);
        return false;
    }
}