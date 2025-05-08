// hardhat.config.js

// 1️⃣ Load .env into process.env
require("dotenv").config();

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
      url: process.env.INFURA_SEPOLIA_URL,  // must match your .env key
      accounts: [process.env.PRIVATE_KEY],  // your deployer key
    },

    // Localhost (if you ever run `npx hardhat node`)
    localhost: {
      url: "http://127.0.0.1:8545"
    }
  }
};
