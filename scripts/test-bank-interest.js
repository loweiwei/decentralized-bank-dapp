const { ethers } = require("hardhat");

async function main() {
  const [user] = await ethers.getSigners();
  const bank = await ethers.getContractAt("BankV3", "0xb05A3519dDcAc3e690F445eC4e6d5C9Da4D30dc8");
  const miniDai = await ethers.getContractAt("MiniDAI", "0x3a0079D1c1dAAF13531a4Eb1D49dF82216bA5E79");

  console.log("✅ 連接成功，帳號:", user.address);

  // 先供應流動性
  await miniDai.mint(user.address, ethers.parseUnits("1000", 18));
  await miniDai.connect(user).approve(bank.getAddress(), ethers.MaxUint256);
  await bank.connect(user).supply(ethers.parseUnits("500", 18));

  // 抵押並借出 100
  await bank.connect(user).depositCollateral({ value: ethers.parseEther("1") });
  await bank.connect(user).borrow(ethers.parseUnits("100", 18));
  console.log("✅ 借款完成：100 mDAI");

  // 初始債務
  let [p0, i0] = await bank.getUserDebt(user.address);
  console.log("📤 [Day 0] 應還本金：", ethers.formatUnits(p0, 18));
  console.log("📤 [Day 0] 應還利息：", ethers.formatUnits(i0, 18));

  // 快轉 2 天
  await ethers.provider.send("evm_increaseTime", [2 * 86400]);
  await ethers.provider.send("evm_mine");

  // 債務增加
  let [p2, i2] = await bank.getUserDebt(user.address);
  const total2 = p2 + i2;
  console.log("⏱️ [Day 2] 應還本金：", ethers.formatUnits(p2, 18));
  console.log("⏱️ [Day 2] 應還利息：", ethers.formatUnits(i2, 18));
  console.log("💰 [Day 2] 總共應還：", ethers.formatUnits(total2, 18));

  // 還款（會還本金+利息）
  await miniDai.mint(user.address, total2); // 給足夠錢還
  await miniDai.connect(user).approve(bank.getAddress(), ethers.MaxUint256);
  await bank.connect(user).repay(total2);
  console.log("✅ 已還清");

  // 再查債務（應該為 0）
  let [p3, i3] = await bank.getUserDebt(user.address);
  console.log("✅ [Day 2 後] 還清後債務 principal =", p3.toString(), " interest =", i3.toString());
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
