// scripts/seedSushiV2.js
require("dotenv").config();
const {
  JsonRpcProvider,
  Wallet,
  Contract,
  parseUnits,
  formatUnits
} = require("ethers");

async function main() {
  const p = new JsonRpcProvider(process.env.INFURA_L2_URL);
  const w = new Wallet(process.env.PRIVATE_KEY, p);

  // ERC20 balance ABI
  const ERC20 = ["function balanceOf(address) view returns (uint256)"];

  // 1) Fetch balances
  const weth = new Contract(process.env.TOKEN0_ADDRESS, ERC20, p);
  const usdc = new Contract(process.env.TOKEN1_ADDRESS, ERC20, p);
  const [balWETH, balUSDC] = await Promise.all([
    weth.balanceOf(w.address),
    usdc.balanceOf(w.address)
  ]);

  console.log("Your balances → WETH:", formatUnits(balWETH,18), "USDC:", formatUnits(balUSDC,6));

  // 2) Decide how much to deposit
  const targetWETH = parseUnits("0.05",18);
  const targetUSDC = parseUnits("140",6);
  const amountA = balWETH < targetWETH ? balWETH : targetWETH;
  const amountB = balUSDC < targetUSDC ? balUSDC : targetUSDC;

  console.log("Seeding with:", formatUnits(amountA,18), "WETH and", formatUnits(amountB,6), "USDC");

  // 3) Approve tokens to router
  const router = new Contract(
    process.env.SUSHI_ROUTER_L2,
    ["function addLiquidity(address,address,uint,uint,uint,uint,address,uint) returns (uint,uint,uint)"],
    w
  );
  console.log("Approving WETH…");
  await (await new Contract(process.env.TOKEN0_ADDRESS, ["function approve(address,uint256)"], w)
    .approve(process.env.SUSHI_ROUTER_L2, amountA)
  ).wait();
  console.log("Approving USDC…");
  await (await new Contract(process.env.TOKEN1_ADDRESS, ["function approve(address,uint256)"], w)
    .approve(process.env.SUSHI_ROUTER_L2, amountB)
  ).wait();

  // 4) Add liquidity
  console.log("Adding liquidity to Sushi V2…");
  const tx = await router.addLiquidity(
    process.env.TOKEN0_ADDRESS,
    process.env.TOKEN1_ADDRESS,
    amountA,
    amountB,
    0, 0,
    w.address,
    Math.floor(Date.now()/1000) + 600
  );
  console.log("TX hash:", tx.hash);
  await tx.wait();
  console.log("✅ Liquidity added");

  // 5) Verify
  const sf = ["function getPair(address,address) view returns (address)"];
  const pr = ["function getReserves() view returns (uint112,uint112,uint32)"];
  const factory = new Contract(
    "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
    sf,
    p
  );
  const pair = await factory.getPair(process.env.TOKEN0_ADDRESS,process.env.TOKEN1_ADDRESS);
  const [r0,r1] = await new Contract(pair, pr, p).getReserves();
  console.log(
    "Sushi V2 reserves:",
    formatUnits(r0,18),
    formatUnits(r1,6)
  );
}

main().catch(e => { console.error(e); process.exit(1); });
