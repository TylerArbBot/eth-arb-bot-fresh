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
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle");

(async () => {
  // ── 0) Global crash & rejection handlers ────────────────────────────────────
  const crashTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
  async function sendCrashAlert(subject, text) {
    try {
      await crashTransporter.sendMail({
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_TO,
        subject,
        text,
      });
    } catch (e) {
      console.error("Failed sending crash alert:", e);
    }
  }
  process.on("uncaughtException", async (err) => {
    console.error("❌ Uncaught exception:", err);
    await sendCrashAlert("❌ Bot Crash: Uncaught Exception", err.stack || err.toString());
    process.exit(1);
  });
  process.on("unhandledRejection", async (reason) => {
    console.error("❌ Unhandled rejection:", reason);
    await sendCrashAlert("❌ Bot Crash: Unhandled Rejection", reason.toString());
    process.exit(1);
  });

  // ── 1) Providers & Wallet ───────────────────────────────────────────────────
  const provider = new JsonRpcProvider(process.env.INFURA_L2_URL);
  const wallet   = new Wallet(process.env.PRIVATE_KEY, provider);

  // ── 2) Routers for off-chain price checks ───────────────────────────────────
  const uniV2Abi = [
    "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory)"
  ];
  const router1 = new Contract(process.env.UNISWAP_ROUTER_L2, uniV2Abi, provider);
  const router2 = new Contract(process.env.SUSHI_ROUTER_L2, uniV2Abi, provider);

  // ── 3) Attach arbitrage contract ─────────────────────────────────────────────
  const arbAbi = require("./artifacts/contracts/MemoryArbBot.sol/MemoryArbBot.json").abi;
  const arbBot = new Contract(process.env.ARBITRAGE_CONTRACT, arbAbi, wallet);

  // ── 4) Email transporter for alerts ──────────────────────────────────────────
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
      to: process.env.EMAIL_TO,
      subject,
      text,
    });
  }

  // ── 5) Strategy parameters ──────────────────────────────────────────────────
  const TRADE_AMOUNT      = parseUnits(process.env.TRADE_AMOUNT,      18);
  const network           = await provider.getNetwork();
  const MIN_PROFIT        = parseUnits(
    network.chainId === 42161
      ? process.env.MIN_PROFIT_MAINNET
      : process.env.MIN_PROFIT_TESTNET
  , 18);
  const WITHDRAW_THRESHOLD= parseUnits(process.env.WITHDRAW_THRESHOLD, 18);
  const INTERVAL_MS       = parseInt(process.env.INTERVAL_MS) || 30000;

  // ── 6) Metrics setup ────────────────────────────────────────────────────────
  const METRICS_FILE = "metrics.csv";
  let tradeCount     = 0;
  let cumProfit      = parseUnits("0", 18);
  if (!fs.existsSync(METRICS_FILE)) {
    fs.writeFileSync(
      METRICS_FILE,
      "trade,timestamp,profit,gasUsed,gasCost,netProfit\n"
    );
  }

  // ── 7) Setup Flashbots ───────────────────────────────────────────────────────
  const authSigner = new Wallet(process.env.FLASHBOTS_SIGNER_PRIVATE_KEY, provider);
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    authSigner,
    process.env.FLASHBOTS_RELAY_URL
  );

  // ── 8) Main loop with concurrency guard ─────────────────────────────────────
  console.log("🚀 Starting arbitrage loop with Flashbots…");
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      // 1️⃣ Off-chain simulate profit (safe)
      let potentialOff = 0n;
      try {
        const amounts = await router1.getAmountsOut(
          TRADE_AMOUNT,
          [process.env.TOKEN0_ADDRESS, process.env.TOKEN1_ADDRESS]
        );
        potentialOff = amounts[1] > TRADE_AMOUNT ? amounts[1] - TRADE_AMOUNT : 0n;
      } catch (err) {
        console.log("⚠️ Off-chain simulate failed (pool empty?):", err.reason||err.message);
      }
      console.log("Off-chain profit:", formatUnits(potentialOff,18), "ETH");

      // 2️⃣ On-chain simulate (safe)
      let potentialOn = 0n;
      try {
        potentialOn = await arbBot.simulateArb(TRADE_AMOUNT);
      } catch (err) {
        console.log("⚠️ On-chain simulate failed:", err.reason||err.message);
      }
      console.log("On-chain simulated profit:", formatUnits(potentialOn,18), "ETH");
      if (potentialOn < MIN_PROFIT) {
        console.log("⚠️ Below MIN_PROFIT, skipping execution");
        return;
      }

      // 3️⃣ Build & send Flashbots bundle
      const execTx = await arbBot.populateTransaction.executeArb(TRADE_AMOUNT, MIN_PROFIT);
      const withdrawTx = await arbBot.populateTransaction.withdrawTokens(process.env.TOKEN0_ADDRESS);

      const signedBundle = await flashbotsProvider.signBundle([
        { signer: wallet, transaction: execTx },
        { signer: wallet, transaction: withdrawTx }
      ]);

      const blockNumber     = await provider.getBlockNumber();
      const bundleResponse  = await flashbotsProvider.sendRawBundle(signedBundle, blockNumber+1);
      const bundleReceipt   = await bundleResponse.wait();
      if ("error" in bundleReceipt) {
        console.error("Flashbots bundle error:", bundleReceipt.error);
        return;
      }
      console.log(`✅ Bundle included in block ${bundleReceipt.blockNumber}`);

      // 4️⃣ Gas & net profit
      const receipt   = bundleReceipt.transactions[0].receipt;
      const gasUsed   = receipt.gasUsed;
      const gasCost   = gasUsed * receipt.effectiveGasPrice;
      const netProfit = potentialOn - gasCost;

      // 5️⃣ Log & alert
      tradeCount++;
      const now = new Date().toISOString();
      fs.appendFileSync(
        METRICS_FILE,
        [tradeCount, now,
         formatUnits(potentialOn,18),
         gasUsed.toString(),
         formatUnits(gasCost,18),
         formatUnits(netProfit,18)
        ].join(",") + "\n"
      );

      // Auto-withdraw alert
      if (cumProfit + netProfit >= WITHDRAW_THRESHOLD) {
        console.log("🔄 Threshold reached—sending withdrawal alert");
        await sendAlert(
          "🔔 Auto-Withdrawal",
          `Withdrew ${formatUnits(cumProfit+netProfit,18)} ETH profit`
        );
        cumProfit = parseUnits("0",18);
      } else {
        cumProfit += netProfit;
      }

      await sendAlert(
        `✅ Arb #${tradeCount}`,
        `Profit: ${formatUnits(netProfit,18)} ETH\nBlock: ${bundleReceipt.blockNumber}`
      );

    } catch (err) {
      console.error("❌ Execution error:", err);
    } finally {
      busy = false;
    }
  }, INTERVAL_MS);
})();
