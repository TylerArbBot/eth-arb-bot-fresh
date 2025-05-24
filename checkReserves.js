require("dotenv").config();
const { JsonRpcProvider, Contract, formatUnits } = require("ethers");

// Provider to connect to Arbitrum
const provider = new JsonRpcProvider(process.env.INFURA_L2_URL);

// Tokens
const WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

// Factory + Pair ABI
const FACTORY = "0xc35DADB65012eC5796536bD9864eD8773aBc74C4";
const factoryAbi = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];
const pairAbi = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
];

async function main() {
  const factory = new Contract(FACTORY, factoryAbi, provider);
  const pairAddress = await factory.getPair(WETH, USDC);

  console.log("WETH/USDC Pair Address:", pairAddress);

  if (pairAddress === "0x0000000000000000000000000000000000000000") {
    console.log("⚠️ Pool not found.");
    return;
  }

  const pair = new Contract(pairAddress, pairAbi, provider);
  const [reserve0, reserve1] = await pair.getReserves();

  console.log(`Reserve 0: ${formatUnits(reserve0, 18)} WETH`);
  console.log(`Reserve 1: ${formatUnits(reserve1, 6)} USDC`);
}

main().catch(console.error);

