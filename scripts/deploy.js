// scripts/deploy.js
require("dotenv").config();               // Load .env variables
const { ethers } = require("hardhat");    // Hardhat’s ethers plugin

async function main() {
  // Who’s deploying?
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Grab the contract factory
  const ArbBot = await ethers.getContractFactory("MemoryArbBot");

  // Deploy, passing in your Sepolia router & token addresses
  const arb = await ArbBot.deploy(
    process.env.UNISWAP_ROUTER,
    process.env.SUSHI_ROUTER,
    process.env.TOKEN0_ADDRESS,
    process.env.TOKEN1_ADDRESS
  );

  // Wait for the deployment transaction to be mined
  await arb.waitForDeployment();

  // Print the new contract address
  console.log("MemoryArbBot deployed at:", arb.target);
}

main().catch((error) => {
  console.error("Error in deployment:", error);
  process.exit(1);
});
