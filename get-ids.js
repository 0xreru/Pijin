const { Asset, Networks } = require('@stellar/stellar-sdk');

const phpc = new Asset("PHPC", "GDDKZAOAME26SD2GAQGGDUTI6F5VQ5CLXXELWOYOAXLUIQTQVLIFWZLY");
console.log("PHPC Contract ID:", phpc.contractId(Networks.TESTNET));

const usdc = new Asset("USDC", "GDQGJU5JTW5IFCGS6JZTIGK57IKPW4N4LJWWEN7F3K3GSEJEYPVJ3BYA");
console.log("USDC Contract ID:", usdc.contractId(Networks.TESTNET));