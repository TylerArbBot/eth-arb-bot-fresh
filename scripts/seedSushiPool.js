// scripts/seedSushiPool.js
require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Seeding Sushi pool as:", deployer.address);

  // Pull addresses from .env
  const tokenAAddress = process.env.TOKENA_ADDRESS;
  const tokenBAddress = process.env.TOKENB_ADDRESS;
  const routerAddress = process.env.SUSHI_ROUTER;    // use Sushi router

  console.log("▶️ tokenAAddress =", tokenAAddress);
  console.log("▶️ tokenBAddress =", tokenBAddress);
  console.log("▶️ sushiRouter    =", routerAddress);

  // Attach to token contracts
  const tokenA = await ethers.getContractAt("TokenA", tokenAAddress, deployer);
  const tokenB = await ethers.getContractAt("TokenB", tokenBAddress, deployer);

  // Minimal ABI for addLiquidity
  const uniV2Abi = [
    "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) external returns (uint256,uint256,uint256)"
  ];
  const router = new ethers.Contract(routerAddress, uniV2Abi, deployer);

  // Approve 100 units of each and wait for confirmations
  const amountA = ethers.parseUnits("100", 18);
  const amountB = ethers.parseUnits("100", 18);
  const approvalA = await tokenA.approve(routerAddress, amountA);
  await approvalA.wait();
  const approvalB = await tokenB.approve(routerAddress, amountB);
  await approvalB.wait();

  // Compute 5% slippage floor
  const minA = (amountA * 95n) / 100n;
  const minB = (amountB * 95n) / 100n;
  const deadline = Math.floor(Date.now() / 1000) + 300; // +5min

  // Add liquidity on Sushi
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

  console.log("✅ Sushi pool seeded: 100 TokenA ↔ 100 TokenB");
}

main().catch(e => {
  console.error("Error in seedSushiPool:", e);
  process.exit(1);
});