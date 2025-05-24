// bot.js
require("dotenv").config();                    // 1) Load .env into process.env
const { ethers } = require("ethers");
const fs = require("fs");
const nodemailer = require("nodemailer");
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle");

(async () => {
  // ── 1) Provider & Wallet ────────────────────────────────────────────────────
  const rpcUrl = process.env.INFURA_L2_URL;
  if (!rpcUrl) {
    console.error("❌ Missing INFURA_L2_URL in your .env");
    process.exit(1);
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  if (!process.env.PRIVATE_KEY) {
    console.error("❌ Missing PRIVATE_KEY in your .env");
    process.exit(1);
  }

  // ── 2) Figure out which network we’re on ────────────────────────────────────
  const network = await provider.getNetwork();
  console.log(`🔗 Connected to chainId ${network.chainId}`);

  // ── 3) Pick the right deployed‐contract address ─────────────────────────────
  //    We keep two vars in .env: ARBITRAGE_CONTRACT (for Arbitrum) and
  //    ARBITRAGE_CONTRACT_SEPOLIA (for Sepolia)
  const arbAddress = (network.chainId === 42161)
    ? process.env.ARBITRAGE_CONTRACT
    : process.env.ARBITRAGE_CONTRACT_SEPOLIA;

  if (!arbAddress) {
    console.error(
      "❌ Missing your ARBITRAGE_CONTRACT address in environment variables!"
    );
    process.exit(1);
  }
  console.log("🤖 Using arbitrage contract at:", arbAddress);

  // ── 4) Routers for off-chain price checks ───────────────────────────────────
  const uniV2Abi = [
    "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory)"
  ];

  const uniRouter = process.env.UNISWAP_ROUTER_L2;
  const sushiRouter = process.env.SUSHI_ROUTER_L2;
  if (!uniRouter || !sushiRouter) {
    console.error("❌ Missing UNISWAP_ROUTER_L2 or SUSHI_ROUTER_L2 in .env");
    process.exit(1);
  }

  const router1 = new ethers.Contract(uniRouter, uniV2Abi, provider);
  const router2 = new ethers.Contract(sushiRouter, uniV2Abi, provider);

  // ── 5) Attach your arbitrage contract ───────────────────────────────────────
  const arbAbi = require("./artifacts/contracts/MemoryArbBot.sol/MemoryArbBot.json").abi;
  const arbBot = new ethers.Contract(arbAddress, arbAbi, wallet);

  // ── 6) Email setup ─────────────────────────────────────────────────────────
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  async function sendAlert(subject, text) {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_TO,
      subject,
      text
    });
  }

  // ── 7) Strategy parameters ─────────────────────────────────────────────────
  const TRADE_AMOUNT       = ethers.parseUnits(process.env.TRADE_AMOUNT, 18);
  const MIN_PROFIT         = ethers.parseUnits(
    network.chainId === 42161
      ? process.env.MIN_PROFIT_MAINNET
      : process.env.MIN_PROFIT_TESTNET,
    18
  );
  const WITHDRAW_THRESHOLD = ethers.parseUnits(process.env.WITHDRAW_THRESHOLD, 18);
  const INTERVAL_MS        = parseInt(process.env.INTERVAL_MS, 10);

  // ── 8) Metric files setup ──────────────────────────────────────────────────
  const METRICS_FILE = "metrics.csv";
  const DEBUG_FILE   = "metrics_debug.csv";
  if (!fs.existsSync(METRICS_FILE)) {
    fs.writeFileSync(METRICS_FILE, "trade,timestamp,profit,gasUsed,gasCost,netProfit\n");
  }
  if (!fs.existsSync(DEBUG_FILE)) {
    fs.writeFileSync(DEBUG_FILE, "tick,timestamp,offchain,onchain\n");
  }

  // ── 9) Flashbots setup ─────────────────────────────────────────────────────
  const authSigner = new ethers.Wallet(process.env.FLASHBOTS_SIGNER_PRIVATE_KEY, provider);
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    authSigner,
    process.env.FLASHBOTS_RELAY_URL
  );

  // ── 🔄 10) Main arbitrage loop ──────────────────────────────────────────────
  console.log("🚀 Starting arbitrage loop…");
  let tradeCount = 0;
  let cumProfit  = ethers.parseUnits("0", 18);

  setInterval(async () => {
    try {
      // 1️⃣ Off-chain price check
      const [off0, off1] = await router1.getAmountsOut(TRADE_AMOUNT, [
        process.env.TOKEN0_ADDRESS,
        process.env.TOKEN1_ADDRESS
      ]);
      const potentialOff = off1 > TRADE_AMOUNT ? off1 - TRADE_AMOUNT : 0n;
      console.log("Off-chain profit:", ethers.formatUnits(potentialOff, 18), "ETH");

      // 2️⃣ On-chain simulation
      let potentialOn = 0n;
      try {
        potentialOn = await arbBot.simulateArb(TRADE_AMOUNT);
        console.log("On-chain simulated profit:", ethers.formatUnits(potentialOn, 18), "ETH");
      } catch (err) {
        console.warn("⚠️ simulateArb failed:", err.message);
      }

      // Debug
      fs.appendFileSync(DEBUG_FILE,
        [tradeCount, new Date().toISOString(),
         ethers.formatUnits(potentialOff, 18),
         ethers.formatUnits(potentialOn, 18)
        ].join(",") + "\n"
      );

      // Skip if below threshold
      if (potentialOn < MIN_PROFIT) {
        console.log("⚠️ Below MIN_PROFIT, skipping");
        return;
      }

      // 3️⃣ Build & send Flashbots bundle
      const execTx     = await arbBot.populateTransaction.executeArb(TRADE_AMOUNT, MIN_PROFIT);
      const withdrawTx = await arbBot.populateTransaction.withdrawTokens(process.env.TOKEN0_ADDRESS);

      const signedBundle = await flashbotsProvider.signBundle([
        { signer: wallet, transaction: execTx },
        { signer: wallet, transaction: withdrawTx }
      ]);
      const blockNumber    = await provider.getBlockNumber();
      const bundleResponse = await flashbotsProvider.sendRawBundle(signedBundle, blockNumber + 1);
      const bundleReceipt  = await bundleResponse.wait();

      if ("error" in bundleReceipt) {
        console.error("Flashbots bundle error:", bundleReceipt.error);
        return;
      }
      console.log(`✅ Bundle included in block ${bundleReceipt.blockNumber}`);

      // 4️⃣ Compute gas & net profit
      const receipt = bundleReceipt.transactions[0].receipt;
      const gasUsed = receipt.gasUsed;
      const gasCost = gasUsed * receipt.effectiveGasPrice;
      const netProfit = potentialOn - gasCost;

      // 5️⃣ Log metrics & send alerts
      tradeCount++;
      const now = new Date().toISOString();
      fs.appendFileSync(METRICS_FILE,
        [
          tradeCount,
          now,
          ethers.formatUnits(potentialOn, 18),
          gasUsed.toString(),
          ethers.formatUnits(gasCost, 18),
          ethers.formatUnits(netProfit, 18)
        ].join(",") + "\n"
      );

      // Auto-withdraw email?
      if (cumProfit + netProfit >= WITHDRAW_THRESHOLD) {
        console.log("🔄 Threshold reached—sending withdrawal alert");
        await sendAlert(
          "🔔 Auto-Withdrawal",
          `Withdrew ${ethers.formatUnits(cumProfit + netProfit, 18)} ETH profit`
        );
        cumProfit = ethers.parseUnits("0", 18);
      } else {
        cumProfit += netProfit;
      }

      // Trade email
      await sendAlert(
        `✅ Arb #${tradeCount}`,
        `Profit: ${ethers.formatUnits(netProfit, 18)} ETH\nIncluded in block ${bundleReceipt.blockNumber}`
      );
    } catch (err) {
      console.error("❌ Execution error:", err);
    }
  }, INTERVAL_MS);
})();
