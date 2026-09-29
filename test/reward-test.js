const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BankV3 - Reward System", function () {
  let deployer, user, lpUser;
  let bank, bankToken, miniDai, oracle, aMDAI;

  beforeEach(async function () {
    [deployer, user, lpUser] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("PriceOracle");
    oracle = await Oracle.deploy();
    await oracle.setPrice(ethers.parseUnits("1000", 8));

    const MiniDAI = await ethers.getContractFactory("MiniDAI");
    miniDai = await MiniDAI.deploy(deployer.address);

    const BankToken = await ethers.getContractFactory("BankToken");
    bankToken = await BankToken.deploy(ethers.parseUnits("1000000", 18));

    const AMDAI = await ethers.getContractFactory("aMDAI");
    aMDAI = await AMDAI.deploy();

    const Bank = await ethers.getContractFactory("BankV3");
    bank = await Bank.deploy(
      await miniDai.getAddress(),
      await oracle.getAddress(),
      deployer.address,
      await bankToken.getAddress(),
      await aMDAI.getAddress()
    );

    await miniDai.setMinter(await bank.getAddress());
    await bankToken.transfer(await bank.getAddress(), ethers.parseUnits("200000", 18));
    await aMDAI.setBank(await bank.getAddress());

    // 發 mDAI 給 LP 用戶
    await miniDai.mint(lpUser.address, ethers.parseUnits("1000", 18));
    await miniDai.connect(lpUser).approve(bank.getAddress(), ethers.parseUnits("1000", 18));
  });

  it("應累積 reward 並成功領出（抵押者）", async function () {
    await bank.connect(user).depositCollateral({ value: ethers.parseEther("1") });
    console.log("✅ [user] 抵押 1 ETH 成功");

    await ethers.provider.send("evm_increaseTime", [3 * 86400]);
    await ethers.provider.send("evm_mine");
    console.log("⏳ 快轉 3 天");

    const before = await bank.getUnclaimedReward(user.address, false);
    console.log("📊 user 可領獎勳（前）:", ethers.formatUnits(before, 18));
    expect(before).to.be.gt(0);

    await bank.connect(user).claimReward(false);
    console.log("🎁 user 領取獎勳成功");

    const after = await bank.getUnclaimedReward(user.address, false);
    console.log("📊 user 可領獎勳（後）:", ethers.formatUnits(after, 18));
    expect(after).to.equal(0);

    const bkt = await bankToken.balanceOf(user.address);
    console.log("💰 user BKT 餘額:", ethers.formatUnits(bkt, 18));
    expect(bkt).to.be.gt(0);
  });

  it("應累積 reward 並成功領出（LP 供應者）", async function () {
    await bank.connect(lpUser).supply(ethers.parseUnits("100", 18));
    console.log("✅ [lpUser] 供應 100 mDAI 成功");

    await ethers.provider.send("evm_increaseTime", [2 * 86400]);
    await ethers.provider.send("evm_mine");
    console.log("⏳ 快轉 2 天");

    const before = await bank.getUnclaimedReward(lpUser.address, true);
    console.log("📊 lpUser 可領獎勳（前）:", ethers.formatUnits(before, 18));
    expect(before).to.be.gt(0);

    await bank.connect(lpUser).claimReward(true);
    console.log("🎁 lpUser 領取獎勳成功");

    const after = await bank.getUnclaimedReward(lpUser.address, true);
    console.log("📊 lpUser 可領獎勳（後）:", ethers.formatUnits(after, 18));
    expect(after).to.equal(0);

    const bkt = await bankToken.balanceOf(lpUser.address);
    console.log("💰 lpUser BKT 餘額:", ethers.formatUnits(bkt, 18));
    expect(bkt).to.be.gt(0);
    const bktLeft = await bankToken.balanceOf(bank.getAddress());
    console.log("🏦 Bank 合約剩餘 BKT:", ethers.formatUnits(bktLeft, 18));

  });

  it("列出 Bank 合約剩餘 BKT", async function () {
    const bktLeft = await bankToken.balanceOf(bank.getAddress());
    console.log("🏦 Bank 合約剩餘 BKT:", ethers.formatUnits(bktLeft, 18));
    expect(bktLeft).to.be.lte(ethers.parseUnits("200000", 18));
  });
});
