// scripts/seedUniL2.js
require("dotenv").config();
const {
  JsonRpcProvider,
  Wallet,
  Contract,
  formatUnits,
  parseUnits
} = require("ethers");

async function main() {
  // 1) Connect to Arbitrum RPC & your wallet
  const provider = new JsonRpcProvider(process.env.INFURA_L2_URL);
  const wallet   = new Wallet(process.env.PRIVATE_KEY, provider);

  console.log("Your wallet:", wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log("Arbitrum ETH balance:", formatUnits(bal, 18));

  // 2) Prepare contracts
  const router = new Contract(
    process.env.UNISWAP_ROUTER_L2,
    [
      // Uniswap V2 addLiquidity signature
      "function addLiquidity(address tokenA,address tokenB,uint amountADesired,uint amountBDesired,uint amountAMin,uint amountBMin,address to,uint deadline) returns (uint amountA, uint amountB, uint liquidity)"
    ],
    wallet
  );
  const tokenA = new Contract(
    process.env.TOKEN0_ADDRESS, // WETH
    ["function approve(address spender,uint256 amount)"],
    wallet
  );
  const tokenB = new Contract(
    process.env.TOKEN1_ADDRESS, // USDC
    ["function approve(address spender,uint256 amount)"],
    wallet
  );

  // 3) Define amounts to seed
  const amountA = parseUnits("0.05", 18); // 0.05 WETH
  const amountB = parseUnits("140", 6);   // ~140 USDC

  console.log(`Approving router to spend 0.05 WETH…`);
  const txA = await tokenA.approve(process.env.UNISWAP_ROUTER_L2, amountA);
  await txA.wait();
  console.log("✓ WETH approved");

  console.log(`Approving router to spend 140 USDC…`);
  const txB = await tokenB.approve(process.env.UNISWAP_ROUTER_L2, amountB);
  await txB.wait();
  console.log("✓ USDC approved");

  // 4) Add liquidity
  console.log(`Sending addLiquidity tx…`);
  const tx = await router.addLiquidity(
    process.env.TOKEN0_ADDRESS,
    process.env.TOKEN1_ADDRESS,
    amountA,
    amountB,
    0,            // minWETH (accept any slippage)
    0,            // minUSDC
    wallet.address,
    Math.floor(Date.now() / 1000) + 600 // deadline = now + 10min
  );
  console.log("Transaction hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("✅ Liquidity added in block", receipt.blockNumber);

  // 5) Verify reserves
  const SF = ["function getPair(address,address) view returns (address)"];
  const PR = ["function getReserves() view returns (uint112,uint112,uint32)"];
  const factory = new Contract(
    "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", // Uniswap V2 factory
    SF,
    provider
  );
  const pair = await factory.getPair(
    process.env.TOKEN0_ADDRESS,
    process.env.TOKEN1_ADDRESS
  );
  const [r0, r1] = await new Contract(pair, PR, provider).getReserves();
  console.log(
    "Uniswap V2 reserves (WETH, USDC):",
    formatUnits(r0, 18),
    formatUnits(r1, 6)
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
