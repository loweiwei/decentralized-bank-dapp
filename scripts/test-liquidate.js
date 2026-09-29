// npx hardhat run scripts/test-liquidate.js --network ganache

const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  // ✅ 取得完整 signer（可轉帳）
  const [owner, liquidator, user] = await ethers.getSigners();

  // ✅ 載入合約地址
  const addressFile = require("../frontend/contract-address.json");

  // ✅ 合約綁定 signer，才能 sendTransaction
  const bankV3 = await ethers.getContractAt("BankV3", addressFile.BankV3, owner);
  const miniDai = await ethers.getContractAt("MiniDAI", addressFile.MiniDAI, owner);
  const oracle = await ethers.getContractAt("PriceOracle", addressFile.PriceOracle, owner);

  console.log("📌 測試清算流程開始");

  // === Step 1: 模擬場景 ===
  console.log("🔧 設定 ETH 價格為 $2000");
  await oracle.setPrice(2000e8);

  console.log("🪙 使用者抵押 1 ETH");
  await bankV3.connect(user).depositCollateral({ value: ethers.parseEther("1") });

  console.log("💰 使用者借出 850 mDAI");
  await bankV3.connect(user).borrow(ethers.parseUnits("850", 18));

  // 快轉 ETH 價格下跌至 $600（導致 HF < 0.825）
  console.log("🔻 將 ETH 價格調降至 $600");
  await oracle.setPrice(600e8);

  // 準備清算人資金
  console.log("💸 Owner 轉 200 mDAI 給清算人");
  await miniDai.connect(owner).transfer(liquidator.address, ethers.parseUnits("200", 18));

  console.log("✅ 清算人批准 200 mDAI 給 BankV3");
  await miniDai.connect(liquidator).approve(bankV3.getAddress(), ethers.parseUnits("200", 18));

  // === Step 2: 執行清算 ===
  const ethBefore = await ethers.provider.getBalance(liquidator.address);
  console.log("🚨 執行清算 user，還 200 mDAI");

  const tx = await bankV3.connect(liquidator).liquidate(user.address, ethers.parseUnits("200", 18));
  await tx.wait();

  const ethAfter = await ethers.provider.getBalance(liquidator.address);
  const receivedETH = ethAfter - ethBefore;

  // === Step 3: 驗證結果 ===
  const collateral = await bankV3.collateral(user.address);
  const remainingDebt = await bankV3.getTotalDebt(user.address);
  const hf = await bankV3.getHealthFactor(user.address);

  console.log("🧾 清算完成！");
  console.log(`💎 清算人實拿 ETH：約 ${ethers.formatEther(receivedETH)} ETH`);
  console.log(`🧱 使用者剩餘抵押：${ethers.formatEther(collateral)} ETH`);
  console.log(`💳 使用者剩餘債務：${ethers.formatUnits(remainingDebt, 18)} mDAI`);
  console.log(`📈 使用者清算後 HF：${(Number(hf) / 1e4).toFixed(4)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
