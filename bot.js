// bot.js
require("dotenv").config();
const {
  FallbackProvider,
  JsonRpcProvider,
  Wallet,
  Contract,
  parseUnits,
  formatUnits
} = require("ethers");
const fs = require("fs");
const nodemailer = require("nodemailer");   // ← new line!

// Explicitly pass the Sepolia chainId (11155111) so they all report the same network
const provider = new FallbackProvider(
  [
    new JsonRpcProvider(process.env.INFURA_SEPOLIA_URL, 11155111),
    new JsonRpcProvider("https://rpc.sepolia.org",      11155111),
    new JsonRpcProvider("https://eth-sepolia.public.blastapi.io", 11155111)
  ],
  1 // quorum: 1
);

const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
// … rest of your bot.js …

// ── 2) Attach your deployed contract ──────────────────────────────────────────
const arbAbi = require("./artifacts/contracts/MemoryArbBot.sol/MemoryArbBot.json").abi;
const arbBot = new Contract(process.env.ARBITRAGE_CONTRACT, arbAbi, wallet);

// ── 3) Email transporter ───────────────────────────────────────────────────────
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

// ── 4) Strategy & withdrawal params ────────────────────────────────────────────
const TRADE_AMOUNT      = parseUnits("0.05", 18);   // 0.05 ETH per attempt
const MIN_PROFIT        = parseUnits("0.0001", 18); // executeArb guard
const WITHDRAW_THRESHOLD= parseUnits("0.2",  18);   // auto-withdraw once 0.2 ETH net
const INTERVAL_MS       = 60_000;                   // loop every 60s

// ── 5) Metrics setup ───────────────────────────────────────────────────────────
const METRICS_FILE = "metrics.csv";
let tradeCount     = 0;
let cumProfit      = parseUnits("0", 18);

// Write CSV header if missing
if (!fs.existsSync(METRICS_FILE)) {
  fs.writeFileSync(
    METRICS_FILE,
    "trade,timestamp,amount0,profit,gasUsed,gasCost,netProfit\n"
  );
}

// ── 6) Main loop ────────────────────────────────────────────────────────────────
console.log("🚀 Starting arbitrage loop…");
setInterval(async () => {
  try {
    // 1️⃣ Off-chain simulate
    const potential = await arbBot.simulateArb(TRADE_AMOUNT);
    console.log("Simulated profit:", formatUnits(potential,18), "ETH");
    if (potential.lt(MIN_PROFIT)) {
      console.log("⚠️ Skipping—below minProfit");
      return;
    }

    // 2️⃣ Execute on-chain trade
    const tx = await arbBot.executeArb(TRADE_AMOUNT, MIN_PROFIT);
    console.log("⛓ Tx sent:", tx.hash);
    const receipt = await tx.wait();
    const gasUsed    = receipt.gasUsed;
    const gasPrice   = receipt.effectiveGasPrice;
    const gasCost    = gasUsed.mul(gasPrice);
    const gasCostEth = formatUnits(gasCost, 18);
    const profitEth  = formatUnits(potential, 18);
    const netProfit  = potential.sub(gasCost);
    const netEth     = formatUnits(netProfit, 18);

    console.log(
      `✅ Trade #${tradeCount+1}: profit=${profitEth} ETH, gas=${gasCostEth} ETH, net=${netEth} ETH`
    );

    // 3️⃣ Log metrics
    tradeCount++;
    const timeStr = new Date().toISOString();
    const row = [
      tradeCount,
      timeStr,
      formatUnits(TRADE_AMOUNT,18),
      profitEth,
      gasUsed.toString(),
      gasCostEth,
      netEth
    ].join(",");
    fs.appendFileSync(METRICS_FILE, row + "\n");

    // 4️⃣ Update cumulative profit & maybe withdraw
    cumProfit = cumProfit.add(netProfit);
    if (cumProfit.gte(WITHDRAW_THRESHOLD)) {
      console.log("🔄 Threshold reached—withdrawing all profit");
      await arbBot.withdrawTokens(process.env.TOKEN0_ADDRESS);
      await sendAlert(
        "🔔 Auto-Withdrawal",
        `Withdrew ${formatUnits(cumProfit,18)} ETH profit to wallet`
      );
      cumProfit = parseUnits("0", 18);
    }

    // 5️⃣ Email alert per trade
    await sendAlert(
      `✅ Arb #${tradeCount}`,
      `Profit: ${profitEth} ETH\nGas: ${gasCostEth} ETH\nNet: ${netEth} ETH\nTx: ${tx.hash}`
    );
  } catch (err) {
    console.error("❌ Execution error:", err.message);
  }
}, INTERVAL_MS);
