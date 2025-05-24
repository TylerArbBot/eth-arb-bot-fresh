// src/checkPairs.js
require('dotenv').config();
const { ethers } = require("ethers");
const factoryAbi = require("../abis/IUniswapV2Factory.json");

async function main() {
  // 1) Read env vars
  const rpcUrl = process.env.RPC_URL;
  const uniFactory = process.env.UNISWAP_FACTORY_L2;
  const sushiFactory = process.env.SUSHI_FACTORY_L2;
  const tokenA = process.env.TOKEN0;
  const tokenB = process.env.TOKEN1;

  // 2) Quick sanity
  if (!rpcUrl || !uniFactory || !sushiFactory || !tokenA || !tokenB) {
    console.error("❌ Missing one of the required env vars.");
    process.exit(1);
  }

  // 3) Set up provider + contracts
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const uni = new ethers.Contract(uniFactory, factoryAbi, provider);
  const sushi = new ethers.Contract(sushiFactory, factoryAbi, provider);

  // 4) Call getPair on both
  const uniPair = await uni.getPair(tokenA, tokenB);
  const sushiPair = await sushi.getPair(tokenA, tokenB);

  console.log("🦄 UniPair Address:", uniPair);
  console.log("🍣 SushiPair Address:", sushiPair);

  // 5) Check existence
  console.log(
    "✅ Uni pair exists?",
    uniPair !== ethers.ZeroAddress ? "yes" : "no"
  );
  console.log(
    "✅ Sushi pair exists?",
    sushiPair !== ethers.ZeroAddress ? "yes" : "no"
  );
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
