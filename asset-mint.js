const { Keypair, Asset, TransactionBuilder, Networks, Horizon, Operation, BASE_FEE } = require('@stellar/stellar-sdk');
const fetch = require('node-fetch');

const stellarServer = new Horizon.Server("https://horizon-testnet.stellar.org");

async function mintAsset(assetCode) {
    try {
        console.log(`\n🏦 Minting ${assetCode}...`);
        const issuer = Keypair.random();
        const distributor = Keypair.random();

        console.log(`Issuer PubKey: ${issuer.publicKey()}`);
        console.log(`Issuer Secret: ${issuer.secret()}`);
        console.log(`Distributor PubKey: ${distributor.publicKey()}`);
        console.log(`Distributor Secret: ${distributor.secret()}`);

        // 1. Fund accounts with Testnet XLM via Friendbot
        console.log("Funding accounts with Friendbot...");
        
        const fundIssuer = await fetch(`https://friendbot.stellar.org?addr=${issuer.publicKey()}`);
        const fundDistributor = await fetch(`https://friendbot.stellar.org?addr=${distributor.publicKey()}`);
        
        // Ensure Friendbot actually succeeded before proceeding
        if (!fundIssuer.ok || !fundDistributor.ok) {
            throw new Error(`Friendbot funding failed! Issuer: ${fundIssuer.status}, Distributor: ${fundDistributor.status}`);
        }

        const issuerAccount = await stellarServer.loadAccount(issuer.publicKey());
        const distributorAccount = await stellarServer.loadAccount(distributor.publicKey());
        const customAsset = new Asset(assetCode, issuer.publicKey());

        // 2. Establish Trustline (Distributor trusts Issuer)
        console.log("Establishing trustline...");
        let tx = new TransactionBuilder(distributorAccount, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
            .addOperation(Operation.changeTrust({ asset: customAsset }))
            .setTimeout(30)
            .build();
        tx.sign(distributor);
        await stellarServer.submitTransaction(tx);

        // 3. Mint 1,000,000,000 tokens to Distributor
        console.log("Minting 1,000,000,000 tokens...");
        let mintTx = new TransactionBuilder(issuerAccount, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
            .addOperation(Operation.payment({
                destination: distributor.publicKey(),
                asset: customAsset,
                amount: "1000000000"
            }))
            .setTimeout(30)
            .build();
        mintTx.sign(issuer);
        await stellarServer.submitTransaction(mintTx);

        console.log(`✅ ${assetCode} successfully minted! Add the Distributor Secret to your .env file.`);
        
    } catch (error) {
        console.error("\n❌ Minting failed:", error?.response?.data?.extras?.result_codes || error.message);
    }
}

mintAsset("PHPC");