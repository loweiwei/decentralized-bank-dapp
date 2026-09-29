const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BankV3 LP Supply Test", function () {
  let deployer, lp, user2, user3;
  let bank, miniDai, bankToken, aMDAI;

  beforeEach(async function () {
    [deployer, lp, user2, user3] = await ethers.getSigners();

    const MiniDAI = await ethers.getContractFactory("MiniDAI");
    miniDai = await MiniDAI.deploy(deployer.address);
    await miniDai.waitForDeployment();

    const BankToken = await ethers.getContractFactory("BankToken");
    bankToken = await BankToken.deploy(ethers.parseUnits("1000000", 18));
    await bankToken.waitForDeployment();

    const AMDAI = await ethers.getContractFactory("aMDAI");
    aMDAI = await AMDAI.deploy();
    await aMDAI.waitForDeployment();

    const Oracle = await ethers.getContractFactory("PriceOracle");
    const oracle = await Oracle.deploy();
    await oracle.setPrice(ethers.parseUnits("1000", 8));

    const Bank = await ethers.getContractFactory("BankV3");
    bank = await Bank.deploy(
      await miniDai.getAddress(),
      await oracle.getAddress(),
      deployer.address,
      await bankToken.getAddress(),
      await aMDAI.getAddress()
    );
    await bank.waitForDeployment();

    await miniDai.setMinter(await bank.getAddress());
    await aMDAI.setBank(await bank.getAddress());

    const amount = ethers.parseUnits("2000", 18);
    await miniDai.connect(deployer).mint(lp.address, amount);
  });

  it("should test LP behavior including cap and multiple users", async function () {
    const first = ethers.parseUnits("1000", 18);
    const second = ethers.parseUnits("1000", 18);

    // === ✅ Set Daily Cap at beginning ===
    await bank.setDailyCap(ethers.parseUnits("3650", 18));

    await miniDai.connect(lp).approve(await bank.getAddress(), first);
    await bank.connect(lp).supply(first);
    await printUserTree(lp, bank, miniDai, bankToken, aMDAI);

    await ethers.provider.send("evm_increaseTime", [3 * 86400]);
    await ethers.provider.send("evm_mine");

    await miniDai.connect(lp).approve(await bank.getAddress(), second);
    await bank.connect(lp).supply(second);
    await printUserTree(lp, bank, miniDai, bankToken, aMDAI);

    await bank.connect(lp).redeem(ethers.parseUnits("1000", 18));
    await printUserTree(lp, bank, miniDai, bankToken, aMDAI);

    await ethers.provider.send("evm_increaseTime", [7 * 86400]);
    await ethers.provider.send("evm_mine");

    const third = ethers.parseUnits("1000", 18);
    await miniDai.connect(deployer).mint(lp.address, third);
    await miniDai.connect(lp).approve(await bank.getAddress(), third);

    await bank.connect(lp).supply(third);
    const pendingReward = await bank.getRewardPreviewCapped(lp.address, true);
    await printUserTree(lp, bank, miniDai, bankToken, aMDAI);

    expect(pendingReward).to.be.gt(0);
    expect(pendingReward).to.be.lte(ethers.parseUnits("3650", 18));

    await bank.connect(lp).redeem(ethers.parseUnits("500", 18));
    await printUserTree(lp, bank, miniDai, bankToken, aMDAI);

    // === 🧲 測試不同帳戶供應 ===
    await miniDai.connect(deployer).mint(user2.address, ethers.parseUnits("500", 18));
    await miniDai.connect(user2).approve(await bank.getAddress(), ethers.parseUnits("500", 18));
    await bank.connect(user2).supply(ethers.parseUnits("500", 18));
    await printUserTree(user2, bank, miniDai, bankToken, aMDAI);

    await miniDai.connect(deployer).mint(user3.address, ethers.parseUnits("1000", 18));
    await miniDai.connect(user3).approve(await bank.getAddress(), ethers.parseUnits("1000", 18));
    await bank.connect(user3).supply(ethers.parseUnits("1000", 18));
    await printUserTree(user3, bank, miniDai, bankToken, aMDAI);

    const lp2 = await bank.lpJoinedAt(user2.address);
    const lp3 = await bank.lpJoinedAt(user3.address);

    expect(lp2).to.not.equal(0);
    expect(lp3).to.not.equal(0);
    expect(lp2).to.not.equal(lp3);
  });
});

async function printUserTree(user, bank, miniDai, bankToken, aMDAI) {
  const addr = user.address;
  const mDAIBalance = await miniDai.balanceOf(addr);
  const bktBalance = await bankToken.balanceOf(addr);
  const aMDAIBalance = await aMDAI.balanceOf(addr);
  const lpJoinTime = await bank.lpJoinedAt(addr);
  const pool = await bank.liquidityPool();

  console.log(`\n📦 使用者狀態樹 (${addr})`);
  console.log(`├─ 💰 mDAI       : ${ethers.formatUnits(mDAIBalance, 18)} mDAI`);
  console.log(`├─ 📄 aMDAI      : ${ethers.formatUnits(aMDAIBalance, 18)} aMDAI`);
  console.log(`├─ 🎖️ BKT        : ${ethers.formatUnits(bktBalance, 18)} BKT`);
  console.log(`├─ ⏱️ LP 加入時間 : ${lpJoinTime} (${lpJoinTime > 0 ? "已加入" : "未加入"})`);
  console.log(`└─ 🏦 流動性池總量: ${ethers.formatUnits(pool, 18)} mDAI`);
}
