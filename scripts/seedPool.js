// scripts/seedPool.js
require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  // Pull raw addresses from .env
  const tokenAAddress = process.env.TOKENA_ADDRESS;
  const tokenBAddress = process.env.TOKENB_ADDRESS;
  const routerAddress = process.env.UNISWAP_ROUTER;

  console.log("▶️ tokenAAddress =", tokenAAddress);
  console.log("▶️ tokenBAddress =", tokenBAddress);
  console.log("▶️ routerAddress =", routerAddress);
  console.log("Seeding pool as:", deployer.address);

  // Attach to your token contracts
  const tokenA = await ethers.getContractAt("TokenA", tokenAAddress, deployer);
  const tokenB = await ethers.getContractAt("TokenB", tokenBAddress, deployer);

  // Minimal ABI for addLiquidity
  const uniV2Abi = [
    "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) external returns (uint256,uint256,uint256)"
  ];
  const router = new ethers.Contract(routerAddress, uniV2Abi, deployer);

  // Approve equal amounts (100 of each)
  const amountA = ethers.parseUnits("100", 18);  // BigInt
  const amountB = ethers.parseUnits("100", 18);

  await tokenA.approve(routerAddress, amountA);
  await tokenB.approve(routerAddress, amountB);

  // Compute 5% slippage tolerance using BigInt math
  const minA = (amountA * 95n) / 100n;
  const minB = (amountB * 95n) / 100n;

  // Add liquidity with 5-minute deadline
  const deadline = Math.floor(Date.now() / 1000) + 300; // now + 5min

  const tx = await router.addLiquidity(
    tokenAAddress,
    tokenBAddress,
    amountA,
    amountB,
    minA,
    minB,
    deployer.address,
    deadline
  );
  await tx.wait();

  console.log("✅ Pool seeded: 100 TokenA ↔ 100 TokenB");
}

main().catch(e => {
  console.error("Error in seedPool:", e);
  process.exit(1);
});
