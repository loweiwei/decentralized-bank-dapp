// scripts/deploy.js
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  //抓出部署者帳號，之後所有部署/呼叫合約的動作都由他發起(hardhat node account[0])
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

// === 1. 部署 PriceOracle ===
  const Oracle = await hre.ethers.getContractFactory("PriceOracle");
  const oracle = await Oracle.deploy();
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log(" PriceOracle:", oracleAddress);
  await oracle.setPrice(hre.ethers.parseUnits("1000", 8));//部署 Oracle 合約，並設定 ETH 價格為 $1000（8 decimals）
  console.log(" Oracle 餵價完成：1000 USD / ETH");
// === 2. 部署 MiniDAI ===
  const MiniDAI = await hre.ethers.getContractFactory("MiniDAI");
  const miniDai = await MiniDAI.deploy(deployer.address);//MiniDAI 是 Bank 借給用戶的穩定幣，初始 minter 是 deployer。
  await miniDai.waitForDeployment();
  const miniDaiAddress = await miniDai.getAddress();
  console.log(" MiniDAI:", miniDaiAddress);

// === 3. 部署 BankToken（治理代幣） ===
  const BankToken = await hre.ethers.getContractFactory("BankToken");
  const initialSupply = hre.ethers.parseUnits("1000000", 18);//一次性鑄造 100 萬顆治理代幣（18 decimals）
  const bankToken = await BankToken.deploy(initialSupply);
  await bankToken.waitForDeployment();
  const bankTokenAddress = await bankToken.getAddress();
  console.log(" BankToken:", bankTokenAddress);

// === 4. 部署 aMDAI（利息代幣） ===
  const aMDAI = await hre.ethers.getContractFactory("aMDAI");
  const aToken = await aMDAI.deploy();//用戶提供流動性時會拿到這個 token，代表他們的 share。
  await aToken.waitForDeployment();
  const aTokenAddress = await aToken.getAddress();
  console.log(" aMDAI:", aTokenAddress);

  // === 5. 部署 BankV3 ===
  const BankV3 = await hre.ethers.getContractFactory("BankV3");
  const bank = await BankV3.deploy(//心借貸邏輯合約，控制 Mint、Borrow、Repay、Liquidation
    miniDaiAddress,
    oracleAddress,
    deployer.address,
    bankTokenAddress,
    aTokenAddress
  );
  await bank.waitForDeployment();
  const bankAddress = await bank.getAddress();
  console.log(" BankV3:", bankAddress);

  // === 6. 初始化權限 ===
  await miniDai.setMinter(bankAddress);//給 Bank 權限鑄造 mDAI、BKT 告知 aMDAI 誰是「控制方」（可發送收益）
  //await bankToken.setMinter(bankAddress);
  await aToken.setBank(bankAddress);
  //console.log(" Minter & Bank roles set.");

// === 7. 部署 TimelockController ===
  const BankTimelock = await hre.ethers.getContractFactory("BankTimelock");
  const minDelay = 20; // ----------------------------------------------------------------
  const proposers = [];
  const executors = [hre.ethers.ZeroAddress];
  const timelock = await BankTimelock.deploy(
    minDelay,
    proposers,
    executors,
    deployer.address
  );
  await timelock.waitForDeployment();
  const timelockAddress = await timelock.getAddress();
  console.log(" Timelock:", timelockAddress);

  // === 8. 部署 Governor ===
  const BankGovernor = await hre.ethers.getContractFactory("BankGovernor");
  const proposalThreshold = hre.ethers.parseUnits("0.1", 18); 
  const quorumPercent = 2;
  const governor = await BankGovernor.deploy(
    bankTokenAddress,
    timelockAddress,
    proposalThreshold,
    quorumPercent
  );
  await governor.waitForDeployment();
  const governorAddress = await governor.getAddress();
  console.log(" BankGovernor:", governorAddress);

  
  // === 9. 移交治理與設定 DAO 權限 ===
  await bank.setGovernance(timelockAddress);
  console.log(" Ownership transferred to Timelock.");

  const proposerRole = await timelock.PROPOSER_ROLE();
  await timelock.grantRole(proposerRole, governorAddress);
  console.log(" Governor granted proposer role.");

  const executorRole = await timelock.EXECUTOR_ROLE();
  await timelock.grantRole(executorRole, hre.ethers.ZeroAddress);
  console.log(" Anyone granted executor role (ZeroAddress).");


  // === 10. 初始 BKT 分配 ===
  await bankToken.transfer(timelockAddress, hre.ethers.parseUnits("600000", 18)); // 60%
  await bankToken.transfer(bankAddress, hre.ethers.parseUnits("200000", 18));     // 20%
  await bankToken.transfer(deployer.address, hre.ethers.parseUnits("200000", 18)); // 20%
  console.log("** Initial BKT distributed: 60% to DAO, 20% to Bank, 20% to deployer.");

  console.log(" ----Initial BKT distributed to Treasury and deployer.");

  // === 11. 輸出前端所需 ABI / 地址 ===
  const frontendDir = path.join(__dirname, "..", "frontend");
  if (!fs.existsSync(frontendDir)) fs.mkdirSync(frontendDir);

  const addresses = {
    PriceOracle: oracleAddress,
    MiniDAI: miniDaiAddress,
    BankToken: bankTokenAddress,
    aMDAI: aTokenAddress,
    BankV3: bankAddress,
    BankTimelock: timelockAddress,
    BankGovernor: governorAddress
  };
  fs.writeFileSync(
    path.join(frontendDir, "contract-address.json"),
    JSON.stringify(addresses, null, 2)
  );

  const saveABI = async (name) => {
    const artifact = await hre.artifacts.readArtifact(name);
    fs.writeFileSync(
      path.join(frontendDir, `${name}.json`),
      JSON.stringify(artifact, null, 2)
    );
  };
  for (const name of [
    "PriceOracle",
    "MiniDAI",
    "BankToken",
    "aMDAI",
    "BankV3",
    "BankTimelock",
    "BankGovernor"
  ]) {
    await saveABI(name);
  }

  console.log(" ABI & addresses exported to frontend/");
}

main().catch((error) => {
  console.error("Deployment error:", error);
  process.exitCode = 1;
});
