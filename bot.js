// bot.js
require("dotenv").config();

const {
  JsonRpcProvider,
  Wallet,
  Contract,
  parseUnits,
  formatUnits
} = require("ethers");
const fs = require("fs");
const nodemailer = require("nodemailer");

// ── 1) Provider & Wallet ──────────────────────────────────────────────────────
const provider = new JsonRpcProvider(process.env.INFURA_SEPOLIA_URL);
const wallet   = new Wallet(process.env.PRIVATE_KEY, provider);

// ── 2) Instantiate Uniswap V2 Router (for off-chain price checks) ─────────────
const uniV2Abi = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory)"
];
const router = new Contract(
  process.env.UNISWAP_ROUTER,
  uniV2Abi,
  provider
);

// ── 3) Attach your deployed arbitrage contract ─────────────────────────────────
const arbAbi = require("./artifacts/contracts/MemoryArbBot.sol/MemoryArbBot.json").abi;
const arbBot = new Contract(
  process.env.ARBITRAGE_CONTRACT,
  arbAbi,
  wallet
);

// ── 4) Email transporter ───────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
async function sendAlert(subject, text) {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to:   process.env.EMAIL_TO,
    subject,
    text
  });
}

// ── 5) Strategy & withdrawal params ────────────────────────────────────────────
const TRADE_AMOUNT       = parseUnits("0.05", 18);
const MIN_PROFIT         = parseUnits("0.0001", 18);
const WITHDRAW_THRESHOLD = parseUnits("0.2",  18);
const INTERVAL_MS        = 60_000;

// ── 6) Metrics setup ───────────────────────────────────────────────────────────
const METRICS_FILE = "metrics.csv";
let tradeCount     = 0;
let cumProfit      = parseUnits("0", 18);

if (!fs.existsSync(METRICS_FILE)) {
  fs.writeFileSync(
    METRICS_FILE,
    "trade,timestamp,amount0,profit,gasUsed,gasCost,netProfit\n"
  );
}

// ── 7) Main loop ────────────────────────────────────────────────────────────────
console.log("🚀 Starting arbitrage loop…");
setInterval(async () => {
  try {
    // 1️⃣ Off-chain price check (optional)
    const amounts = await router.getAmountsOut(
      TRADE_AMOUNT,
      [process.env.TOKEN0_ADDRESS, process.env.TOKEN1_ADDRESS]
    );
    const potentialOffchain = (amounts[1] > TRADE_AMOUNT)
      ? (amounts[1] - TRADE_AMOUNT)
      : 0n;
    console.log(
      "Off-chain simulated profit:",
      formatUnits(potentialOffchain, 18),
      "ETH"
    );

    // 2️⃣ On-chain simulate
    const potential = await arbBot.simulateArb(TRADE_AMOUNT);
    console.log(
      "On-chain simulated profit:",
      formatUnits(potential,18),
      "ETH"
    );
    if (potential < MIN_PROFIT) {
      console.log("⚠️ Below minProfit, skipping");
      return;
    }

    // 3️⃣ Execute on-chain trade
    const tx      = await arbBot.executeArb(TRADE_AMOUNT, MIN_PROFIT);
    console.log("⛓ Tx sent:", tx.hash);
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed;
    const gasCost = gasUsed * receipt.effectiveGasPrice;
    const netProf = potential - gasCost;

    const profitEth = formatUnits(potential,18);
    const gasEth    = formatUnits(gasCost,18);
    const netEth    = formatUnits(netProf,18);

    console.log(
      `✅ Trade #${tradeCount+1}: profit=${profitEth} ETH, gas=${gasEth} ETH, net=${netEth} ETH`
    );

    // 4️⃣ Log metrics
    tradeCount++;
    const now = new Date().toISOString();
    fs.appendFileSync(
      METRICS_FILE,
      [tradeCount, now, profitEth, gasUsed.toString(), gasEth, netEth]
        .join(",") + "\n"
    );

    // 5️⃣ Withdraw if threshold reached
    cumProfit = cumProfit + netProf;
    if (cumProfit >= WITHDRAW_THRESHOLD) {
      console.log("🔄 Threshold reached—withdrawing profit");
      await arbBot.withdrawTokens(process.env.TOKEN0_ADDRESS);
      await sendAlert(
        "🔔 Auto-Withdrawal",
        `Withdrew ${formatUnits(cumProfit,18)} ETH profit to wallet`
      );
      cumProfit = parseUnits("0", 18);
    }

    // 6️⃣ Send email alert
    await sendAlert(
      `✅ Arb #${tradeCount}`,
      `Profit: ${profitEth} ETH\nGas: ${gasEth} ETH\nNet: ${netEth} ETH\nTx: ${tx.hash}`
    );

  } catch (err) {
    console.error("❌ Execution error:", err.message);
  }
}, INTERVAL_MS);