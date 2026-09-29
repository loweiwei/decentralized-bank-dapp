const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("👤 執行者帳號:", deployer.address);

  // === 載入地址 ===
  const addressFile = path.join(__dirname, "..", "frontend", "contract-address.json");
  const addresses = JSON.parse(fs.readFileSync(addressFile));

  const bankV3 = await ethers.getContractAt("BankV3", addresses.BankV3);
  const governor = await ethers.getContractAt("BankGovernor", addresses.BankGovernor);
  const timelock = await ethers.getContractAt("BankTimelock", addresses.BankTimelock);
  const bankToken = await ethers.getContractAt("BankToken", addresses.BankToken);

  // === 將投票權委託給自己 ===
  const delegateTx = await bankToken.delegate(deployer.address);
  await delegateTx.wait();
  console.log("✅ 已委託投票權給自己");

  // === 提案邏輯 ===
  const newCap = ethers.parseUnits("20000", 18);
  const description = `📝 提案：將 dailyCap 提高至 20000 - ${Date.now()}`; // 加上 timestamp 保證唯一
  const encoded = bankV3.interface.encodeFunctionData("setDailyCap", [newCap]);
  const target = await bankV3.getAddress();

  const proposeTx = await governor.propose([target], [0], [encoded], description);
  const proposeReceipt = await proposeTx.wait();
  const proposalId = proposeReceipt.logs[0].args.proposalId;
  console.log("🧾 提案成功 Proposal ID:", proposalId.toString());

  // 等待投票開始（voting delay）
  await ethers.provider.send("evm_mine");

  const voteTx = await governor.castVote(proposalId, 1); // 1 = For
  const voteReceipt = await voteTx.wait();
  console.log("🗳️ 投票完成, status:", voteReceipt.status);

  // 模擬投票期過去（通常至少 5 區塊）
  for (let i = 0; i < 5; i++) {
    await ethers.provider.send("evm_mine");
  }

  const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes(description));
  const queueTx = await governor.queue([target], [0], [encoded], descriptionHash);
  const queueReceipt = await queueTx.wait();
  console.log("⏳ Queue 完成, status:", queueReceipt.status);

  // 模擬 Timelock 解鎖等待時間（delay）
  await ethers.provider.send("evm_increaseTime", [30]);
  await ethers.provider.send("evm_mine");

  const executeTx = await governor.execute([target], [0], [encoded], descriptionHash);
  const executeReceipt = await executeTx.wait();
  console.log("🚀 Execute tx status:", executeReceipt.status);

  // === 🔍 Trace 交易內部執行（若有 tracer）
  if (hre.tracer?.trace) {
    await hre.tracer.trace(executeTx.hash);
  } else {
    console.warn("⚠️ tracer 插件未啟用，請確認 hardhat.config.js 有 require('hardhat-tracer')");
  }

  // === 檢查 dailyCap 是否真的更新
  const updatedCap = await bankV3.dailyCap();
  console.log("✅ 現在 dailyCap:", ethers.formatUnits(updatedCap, 18));

  // === 檢查事件是否有觸發
  const logs = await bankV3.queryFilter("DailyCapChanged");
  if (logs.length > 0) {
    console.log("📢 已觸發 DailyCapChanged:", ethers.formatUnits(logs.at(-1).args.newCap, 18));
  } else {
    console.log("❌ 沒有觸發 DailyCapChanged，可能 call 被吞掉或 revert");
  }
}

main().catch((err) => {
  console.error("❌ 錯誤:", err.message || err);
  process.exit(1);
});
