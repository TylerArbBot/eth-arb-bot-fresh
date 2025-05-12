// scripts/deployTokens.js
require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying as:", deployer.address);

  // 1) Deploy TokenA
  const TokenA = await ethers.getContractFactory("TokenA");
  console.log("Deploying TokenA (TKA)...");
  const tokenA = await TokenA.deploy();
  await tokenA.waitForDeployment();
  console.log("TokenA deployed at:", tokenA.target);

  // Mint 1,000 TKA to deployer using ethers.parseUnits
  const amountA = ethers.parseUnits("1000", 18);
  await tokenA.connect(deployer).mint(deployer.address, amountA);
  console.log(`Minted ${ethers.formatUnits(amountA,18)} TKA to deployer.`);

  // 2) Deploy TokenB
  const TokenB = await ethers.getContractFactory("TokenB");
  console.log("Deploying TokenB (TKB)...");
  const tokenB = await TokenB.deploy();
  await tokenB.waitForDeployment();
  console.log("TokenB deployed at:", tokenB.target);

  // Mint 2,000 TKB to deployer
  const amountB = ethers.parseUnits("2000", 18);
  await tokenB.connect(deployer).mint(deployer.address, amountB);
  console.log(`Minted ${ethers.formatUnits(amountB,18)} TKB to deployer.`);
}

main().catch(e => {
  console.error("Error in deployTokens:", e);
  process.exit(1);
});