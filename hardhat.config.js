// hardhat.config.js
require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const { PRIVATE_KEY, INFURA_SEPOLIA_URL, INFURA_L2_URL } = process.env;

const networks = {
  localhost: {
    url: "http://127.0.0.1:8545"
  }
};

// only add Sepolia if the URL is defined
if (INFURA_SEPOLIA_URL && PRIVATE_KEY) {
  networks.sepolia = {
    url: INFURA_SEPOLIA_URL,
    accounts: [PRIVATE_KEY]
  };
}

// add Arbitrum One
if (INFURA_L2_URL && PRIVATE_KEY) {
  networks.arbitrum = {
    url: INFURA_L2_URL,
    accounts: [PRIVATE_KEY]
  };
}

module.exports = {
  solidity: "0.8.28",
  networks
};
