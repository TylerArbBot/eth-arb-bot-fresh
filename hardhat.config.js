// hardhat.config.js

// 1️⃣ Load .env into process.env
envFile = require("dotenv").config();

// 2️⃣ Load Hardhat’s toolbox (ethers, waffle, etc.)
require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  // 3️⃣ Solidity compiler version
  solidity: "0.8.28",

  // 4️⃣ Network definitions
  networks: {
    // Sepolia testnet
    sepolia: {
      url: process.env.INFURA_SEPOLIA_URL,  // from .env
      accounts: [process.env.PRIVATE_KEY],  // your deploy key
    },

    // Arbitrum One mainnet
    arbitrum: {
      url: process.env.INFURA_L2_URL,       // Arbitrum RPC URL
      accounts: [process.env.PRIVATE_KEY],  // same deploy key
    },

    // Localhost (if you ever run `npx hardhat node`)
    localhost: {
      url: "http://127.0.0.1:8545"
    }
  },

  // 5️⃣ Etherscan (Arbiscan) plugin for contract verification (optional)
  etherscan: {
    apiKey: {
      // Specify your Arbiscan API key in .env as ARBISCAN_API_KEY
      arbitrumOne: process.env.ARBISCAN_API_KEY || ""
    }
  }
};
