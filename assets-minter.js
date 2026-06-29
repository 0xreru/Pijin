const { Keypair, Asset, TransactionBuilder, Networks, Horizon, Operation, BASE_FEE } = require('@stellar/stellar-sdk');
const fetch = require('node-fetch');

const stellarServer = new Horizon.Server("https://horizon-testnet.stellar.org");

async function mintAsset(assetCode) {
    console.log(`\n🏦 Minting ${assetCode}...`);
    const issuer = Keypair.random();
    const distributor = Keypair.random();

    console.log(`Issuer PubKey: ${issuer.publicKey()}`);
    console.log(`Issuer Secret: ${issuer.secret()}`);
    console.log(`Distributor PubKey: ${distributor.publicKey()}`);
    console.log(`Distributor Secret: ${distributor.secret()}`);

    // 1. Fund accounts with Testnet XLM via Friendbot
    console.log("Funding accounts with Friendbot...");
    await fetch(`https://friendbot.stellar.org?addr=${issuer.publicKey()}`);
    await fetch(`https://friendbot.stellar.org?addr=${distributor.publicKey()}`);

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

    // 3. Mint 1,000,000 tokens to Distributor
    console.log("Minting 1,000,000 tokens...");
    let mintTx = new TransactionBuilder(issuerAccount, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.payment({
            destination: distributor.publicKey(),
            asset: customAsset,
            amount: "1000000"
        }))
        .setTimeout(30)
        .build();
    mintTx.sign(issuer);
    await stellarServer.submitTransaction(mintTx);

    console.log(`✅ ${assetCode} successfully minted! Add the Distributor Secret to your .env file.`);
}

async function run() {
    await mintAsset("PHPC");
    await mintAsset("USDC");
}
run();
