const hre = require("hardhat");
const fs = require("fs");

async function main() {
  // 使用 owner 帳號（你部署 MiniDAI 時設定的那個）
  const [owner, user1, user2, user3, user4] = await hre.ethers.getSigners();
  console.log("🧑 使用 owner 帳號:", owner.address);

  // 讀取 MiniDAI 地址
  const addresses = JSON.parse(fs.readFileSync("frontend/contract-address.json"));
  const miniDaiAddress = addresses.MiniDAI;

  // 接上 MiniDAI 合約
  const MiniDAI = await hre.ethers.getContractFactory("MiniDAI");
  const miniDai = await MiniDAI.attach(miniDaiAddress);

  // 要轉帳的對象與金額
  const recipients = [user1.address, user2.address, user3.address, user4.address];
  const amount = hre.ethers.parseEther("20000");
  const totalAmount = amount * BigInt(recipients.length);

  // Step 1: Mint 所有要用的總金額
  console.log(` 鑄造 ${hre.ethers.formatUnits(totalAmount, 18)} 顆 MiniDAI 到自己...`);
  await (await miniDai.mint(owner.address, totalAmount)).wait();

  // Step 2: 批次轉帳
  for (const recipient of recipients) {
    console.log(` 轉帳 ${hre.ethers.formatUnits(amount, 18)} MiniDAI 給 ${recipient} ...`);
    await (await miniDai.transfer(recipient, amount)).wait();
  }

  // Step 3: 查詢所有帳號餘額
  for (const recipient of recipients) {
    const balance = await miniDai.balanceOf(recipient);
    console.log(` ${recipient} 現在有 ${hre.ethers.formatUnits(balance, 18)} MiniDAI`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
