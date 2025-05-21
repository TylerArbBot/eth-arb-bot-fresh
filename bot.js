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
  // ── 1) Providers & Wallets ─────────────────────────────────────────────────
  const provider = new JsonRpcProvider(process.env.INFURA_L2_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);

  // ── 2) Routers for off-chain price checks ─────────────────────────────────
  const uniV2Abi = [
    "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory)"
  ];
  const router1 = new Contract(
    process.env.UNISWAP_ROUTER_L2,
    uniV2Abi,
    provider
  );
  const router2 = new Contract(
    process.env.SUSHI_ROUTER_L2,
    uniV2Abi,
    provider
  );

  // ── 3) Attach your deployed arbitrage contract ─────────────────────────────
  const arbAbi = require(
    "./artifacts/contracts/MemoryArbBot.sol/MemoryArbBot.json"
  ).abi;
  const arbBot = new Contract(
    process.env.ARBITRAGE_CONTRACT,
    arbAbi,
    wallet
  );

  // ── 4) Email transporter ───────────────────────────────────────────────────
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

  // ── 5) Strategy parameters ────────────────────────────────────────────────
  const TRADE_AMOUNT = parseUnits(process.env.TRADE_AMOUNT, 18);
  const network = await provider.getNetwork();
  const MIN_PROFIT = parseUnits(
    network.chainId === 42161
      ? process.env.MIN_PROFIT_MAINNET
      : process.env.MIN_PROFIT_TESTNET,
    18
  );
  const WITHDRAW_THRESHOLD = parseUnits(
    process.env.WITHDRAW_THRESHOLD,
    18
  );
  const INTERVAL_MS = parseInt(process.env.INTERVAL_MS, 10);

  // ── 6) Metrics setup ──────────────────────────────────────────────────────
  const METRICS_FILE = "metrics.csv";
  const DEBUG_FILE = "metrics_debug.csv";
  let tradeCount = 0;
  let cumProfit = parseUnits("0", 18);

  if (!fs.existsSync(METRICS_FILE)) {
    fs.writeFileSync(
      METRICS_FILE,
      "trade,timestamp,profit,gasUsed,gasCost,netProfit\n"
    );
  }
  if (!fs.existsSync(DEBUG_FILE)) {
    fs.writeFileSync(
      DEBUG_FILE,
      "tick,timestamp,offchain,onchain\n"
    );
  }

  // ── 7) Setup Flashbots ─────────────────────────────────────────────────────
  const authSigner = new Wallet(
    process.env.FLASHBOTS_SIGNER_PRIVATE_KEY,
    provider
  );
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    authSigner,
    process.env.FLASHBOTS_RELAY_URL
  );

  // ── 8) Start main loop ────────────────────────────────────────────────────
  console.log("🚀 Starting arbitrage loop with Flashbots…");
  setInterval(async () => {
    try {
      // 1️⃣ Off-chain simulate profit
      const amounts = await router1.getAmountsOut(
        TRADE_AMOUNT,
        [process.env.TOKEN0_ADDRESS, process.env.TOKEN1_ADDRESS]
      );
      const potentialOff =
        amounts[1] > TRADE_AMOUNT ? amounts[1] - TRADE_AMOUNT : 0n;
      console.log(
        "Off-chain profit:",
        formatUnits(potentialOff, 18),
        "ETH"
      );

      // 2️⃣ On-chain simulate
      let potentialOn;
      try {
        potentialOn = await arbBot.simulateArb(TRADE_AMOUNT);
        console.log(
          "On-chain simulated profit:",
          formatUnits(potentialOn, 18),
          "ETH"
        );
      } catch (err) {
        console.log("⚠️ On-chain simulate failed:", err.message);
        potentialOn = 0n;
      }

      // 📟 Debug log every tick
      fs.appendFileSync(
        DEBUG_FILE,
        [
          tradeCount,
          new Date().toISOString(),
          formatUnits(potentialOff, 18),
          formatUnits(potentialOn, 18)
        ].join(",") + "\n"
      );

      //  Check profit threshold
      if (potentialOn < MIN_PROFIT) {
        console.log("⚠️ Below MIN_PROFIT, skipping execution");
        return;
      }

      // 3️⃣ Build & send Flashbots bundle
      const execTx = await arbBot.populateTransaction.executeArb(
        TRADE_AMOUNT,
        MIN_PROFIT
      );
      const withdrawTx = await arbBot.populateTransaction.withdrawTokens(
        process.env.TOKEN0_ADDRESS
      );

      const signedBundle = await flashbotsProvider.signBundle([
        { signer: wallet, transaction: execTx },
        { signer: wallet, transaction: withdrawTx }
      ]);

      const blockNumber = await provider.getBlockNumber();
      const bundleResponse = await flashbotsProvider.sendRawBundle(
        signedBundle,
        blockNumber + 1
      );
      const bundleReceipt = await bundleResponse.wait();

      if ("error" in bundleReceipt) {
        console.error("Flashbots bundle error:", bundleReceipt.error);
        return;
      }
      console.log(
        `✅ Bundle included in block ${bundleReceipt.blockNumber}`
      );

      // 4️⃣ Compute gas & net profit
      const receipt = bundleReceipt.transactions[0].receipt;
      const gasUsed = receipt.gasUsed;
      const gasCost = gasUsed * receipt.effectiveGasPrice;
      const netProfit = potentialOn - gasCost;

      // 5️⃣ Log metrics & send alerts
      tradeCount++;
      const now = new Date().toISOString();
      fs.appendFileSync(
        METRICS_FILE,
        [
          tradeCount,
          now,
          formatUnits(potentialOn, 18),
          gasUsed.toString(),
          formatUnits(gasCost, 18),
          formatUnits(netProfit, 18)
        ].join(",") + "\n"
      );

      if (cumProfit + netProfit >= WITHDRAW_THRESHOLD) {
        console.log("🔄 Threshold reached—sending withdrawal alert");
        await sendAlert(
          "🔔 Auto-Withdrawal",
          `Withdrew ${formatUnits(cumProfit + netProfit, 18)} ETH profit`
        );
        cumProfit = parseUnits("0", 18);
      } else {
        cumProfit += netProfit;
      }

      await sendAlert(
        `✅ Arb #${tradeCount}`,
        `Profit: ${formatUnits(netProfit, 18)} ETH\nTx: bundle @ block ${bundleReceipt.blockNumber}`
      );
    } catch (err) {
      console.error("❌ Execution error:", err);
    }
  }, INTERVAL_MS);
})();
