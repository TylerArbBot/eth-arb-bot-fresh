// bot.js
require("dotenv").config();

const {
  JsonRpcProvider,
  Wallet,
  Contract,
  parseUnits,
  formatUnits
} = require("ethers");
const nodemailer = require("nodemailer");

// ── 1) Setup provider & wallet ────────────────────────────────────────────────
const provider = new JsonRpcProvider(process.env.INFURA_SEPOLIA_URL);
const wallet   = new Wallet(process.env.PRIVATE_KEY, provider);

// ── 2) Attach your deployed contract ──────────────────────────────────────────
const arbAbi = require("./artifacts/contracts/MemoryArbBot.sol/MemoryArbBot.json").abi;
const arbBot = new Contract(process.env.ARBITRAGE_CONTRACT, arbAbi, wallet);

// ── 3) Configure email transporter ────────────────────────────────────────────
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

// ── 4) Strategy parameters ────────────────────────────────────────────────────
// Trade 0.05 ETH each attempt (1/4 of your 0.2 ETH bankroll)
const TRADE_AMOUNT = parseUnits("0.05", 18);

// Only execute if profit ≥ 0.0001 ETH (~0.2% of 0.05 ETH)
// This covers typical L2 gas (~0.00002–0.00005 ETH) and leaves buffer
const MIN_PROFIT   = parseUnits("0.0001", 18);

// How often to check (in milliseconds)
const INTERVAL_MS  = 60_000; // every 60 seconds

console.log("🚀 Starting arbitrage loop…");
setInterval(async () => {
  try {
    // 1️⃣ Off-chain simulate
    const potential = await arbBot.simulateArb(TRADE_AMOUNT);
    console.log(
      "Simulated profit:",
      formatUnits(potential, 18),
      "ETH"
    );

    // 2️⃣ Skip if below your threshold
    if (potential.lt(MIN_PROFIT)) {
      console.log("⚠️ Skipping: profit below", formatUnits(MIN_PROFIT, 18));
      return;
    }

    // 3️⃣ Submit the on-chain transaction with two args
    const tx = await arbBot.executeArb(
      TRADE_AMOUNT,
      MIN_PROFIT,
      {
        // (optional) you can set gasPrice or maxFeePerGas here if you want
      }
    );
    console.log("⛓ Tx sent:", tx.hash);

    // 4️⃣ Wait for confirmation
    const receipt = await tx.wait();
    console.log(
      "✅ Executed in block",
      receipt.blockNumber,
      "| Profit:",
      formatUnits(potential, 18),
      "ETH"
    );

    // 5️⃣ Alert via email
    await sendAlert(
      "✅ Arb Executed",
      `Profit: ${formatUnits(potential, 18)} ETH\nTx: ${tx.hash}`
    );
  } catch (err) {
    console.error("❌ Execution error:", err.message);
  }
}, INTERVAL_MS);
