module.exports = {
  migrations_directory: "./migrations",
  contracts_directory: "./contracts",
  networks: {
    development: {
      host: "localhost",
      port: 8545,
      network_id: "*",
      gas: 8_000_000,
      // 100 gwei
      gasPrice: 100_000_000_000,
    },
  },
  compilers: {
    solc: {
      version: "0.6.12",
      docker: false,
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
        evmVersion: "istanbul",
      },
    },
  },
};
