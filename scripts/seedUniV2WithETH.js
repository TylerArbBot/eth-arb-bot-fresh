// scripts/seedUniV2WithETH.js
require("dotenv").config();
const { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits } = require("ethers");

async function main() {
  const provider = new JsonRpcProvider(process.env.INFURA_L2_URL);
  const wallet   = new Wallet(process.env.PRIVATE_KEY, provider);

  console.log("Wallet:", wallet.address);
  const ethBal = await provider.getBalance(wallet.address);
  console.log("ETH balance:", formatUnits(ethBal,18));

  // Uniswap V2 router
  const router = new Contract(
    process.env.UNISWAP_ROUTER_L2,
    [
      // addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable
      "function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) payable returns (uint256,uint256,uint256)"
    ],
    wallet
  );
  // USDC token for approval
  const usdc = new Contract(
    process.env.TOKEN1_ADDRESS,
    ["function approve(address,uint256)"],
    wallet
  );

  // How much ETH & USDC to seed?
  const ethToSeed  = parseUnits("0.05", 18);  // 0.05 native ETH
  const usdcToSeed = parseUnits("140", 6);    // ~140 USDC

  // 1) Approve USDC
  console.log(`Approving router to spend ${formatUnits(usdcToSeed,6)} USDC…`);
  const txA = await usdc.approve(process.env.UNISWAP_ROUTER_L2, usdcToSeed);
  await txA.wait();
  console.log("✓ USDC approved");

  // 2) Call addLiquidityETH
  console.log("Sending addLiquidityETH…");
  const tx = await router.addLiquidityETH(
    process.env.TOKEN1_ADDRESS,   // USDC
    usdcToSeed,                   // amountTokenDesired
    0,                            // amountTokenMin (accept any slippage)
    0,                            // amountETHMin
    wallet.address,               // to
    Math.floor(Date.now()/1000)+600, // deadline now+10m
    { value: ethToSeed }          // native ETH to send
  );
  console.log("TX hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("✅ Liquidity added in block", receipt.blockNumber);

  // 3) Verify V2 reserves
  const SF = ["function getPair(address,address) view returns (address)"];
  const PR = ["function getReserves() view returns (uint112,uint112,uint32)"];
  const factory = new Contract(
    "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    SF,
    provider
  );
  const pair = await factory.getPair(process.env.TOKEN0_ADDRESS, process.env.TOKEN1_ADDRESS);
  const [r0,r1] = await new Contract(pair, PR, provider).getReserves();
  console.log(
    "Uniswap V2 reserves (WETH, USDC):",
    formatUnits(r0,18),
    formatUnits(r1,6)
  );
}

main().catch(err=>{
  console.error(err);
  process.exit(1);
});
