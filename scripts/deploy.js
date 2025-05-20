// scripts/deploy.js

require("dotenv").config();
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const networkName = hre.network.name;

  // 1) Choose env vars based on network
  let r1, r2, t0, t1;
  if (networkName === "arbitrum") {
    r1 = process.env.UNISWAP_ROUTER_L2;
    r2 = process.env.SUSHI_ROUTER_L2;
    t0 = process.env.TOKEN0_ADDRESS;
    t1 = process.env.TOKEN1_ADDRESS;
  } else if (networkName === "sepolia") {
    r1 = process.env.UNISWAP_ROUTER_SEPOLIA;
    r2 = process.env.SUSHI_ROUTER_SEPOLIA;
    t0 = process.env.TOKENA_ADDRESS;
    t1 = process.env.TOKENB_ADDRESS;
  } else {
    console.error(`Unsupported network: ${networkName}`);
    process.exit(1);
  }

  // 2) Sanity check
  if (!r1 || !r2 || !t0 || !t1) {
    console.error("❌ Missing one of the env vars:", {
      [`UNISWAP_ROUTER_${networkName === "arbitrum" ? "L2" : "SEPOLIA"}`]: r1,
      [`SUSHI_ROUTER_${networkName === "arbitrum" ? "L2" : "SEPOLIA"}`]: r2,
      [networkName === "arbitrum" ? "TOKEN0_ADDRESS" : "TOKENA_ADDRESS"]: t0,
      [networkName === "arbitrum" ? "TOKEN1_ADDRESS" : "TOKENB_ADDRESS"]: t1
    });
    process.exit(1);
  }

  // 3) Deploy
  const [deployer] = await ethers.getSigners();
  console.log(`🔑 Deploying to ${networkName} with account: ${deployer.address}`);

  const ArbFactory = await ethers.getContractFactory("MemoryArbBot");
  const arb = await ArbFactory.deploy(r1, r2, t0, t1);

  await arb.waitForDeployment();
  console.log(`✅ MemoryArbBot deployed to: ${arb.target}`);
}

main().catch(err => {
  console.error("❌ Error in deployment:", err);
  process.exit(1);
});
