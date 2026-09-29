// test/BankV3-test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

const SECONDS_PER_YEAR = 60;
const DECIMALS = 1e4;

describe("BankV3 End-to-End", function () {
  let bank, miniDai, oracle, aMDAI, bankToken;
  let owner, user, liquidator;

  beforeEach(async () => {
    [owner, user, liquidator] = await ethers.getSigners();

    const MiniDAI = await ethers.getContractFactory("MiniDAI");
    miniDai = await MiniDAI.deploy(owner.address);
    await miniDai.waitForDeployment();
    await miniDai.mint(owner.address, ethers.parseEther("10000"));

    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    oracle = await PriceOracle.deploy();
    await oracle.waitForDeployment();
    await oracle.setPrice(ethers.parseUnits("2000", 8));

    const BankToken = await ethers.getContractFactory("BankToken");
    bankToken = await BankToken.deploy(ethers.parseUnits("1000000", 18));
    await bankToken.waitForDeployment();

    const aMDAIFactory = await ethers.getContractFactory("aMDAI");
    aMDAI = await aMDAIFactory.deploy();
    await aMDAI.waitForDeployment();

    const BankV3 = await ethers.getContractFactory("BankV3");
    bank = await BankV3.deploy(
      await miniDai.getAddress(),
      await oracle.getAddress(),
      owner.address,
      await bankToken.getAddress(),
      await aMDAI.getAddress()
    );
    await bank.waitForDeployment();

    await miniDai.setMinter(await bank.getAddress());
    await aMDAI.setBank(await bank.getAddress());

    await miniDai.connect(owner).approve(await bank.getAddress(), ethers.parseEther("1000"));
    await bank.connect(owner).supply(ethers.parseEther("1000"));

    await bank.setInterestRate(2000); // 測試用最高利率 20%
  });

  it("should allow user to deposit ETH and borrow mDAI", async () => {
    await bank.connect(user).depositCollateral({ value: ethers.parseEther("1") });
    await bank.connect(owner).setDailyCap(ethers.parseEther("9000"));

    await bank.connect(user).borrow(ethers.parseEther("800"));
    const health = await bank.getHealthFactor(user.address);
    console.log("✅ Health after borrow:", health.toString());
    expect(health).to.be.greaterThan(ethers.parseUnits("1", 4));
  });

  it("should accrue interest and reduce health factor", async () => {
    await bank.connect(user).depositCollateral({ value: ethers.parseEther("1") });
    await bank.connect(user).borrow(ethers.parseEther("980"));
    await oracle.setPrice(ethers.parseUnits("500", 8));
    await ethers.provider.send("evm_increaseTime", [SECONDS_PER_YEAR * 30]);
    await ethers.provider.send("evm_mine", []);

    const health = await bank.getHealthFactor(user.address);
    const debt = await bank.getTotalDebt(user.address);
    const collateral = await bank.getCollateralValueUSD(user.address);
    console.log("💥 Health Factor:", health.toString());
    console.log("📊 Total Debt:", debt.toString());
    console.log("📊 Collateral Value:", collateral.toString());
    expect(health).to.be.lessThan(ethers.parseUnits("1", 4));
  });

  it("should allow liquidation when health factor < threshold", async () => {
    await bank.connect(user).depositCollateral({ value: ethers.parseEther("1") });
    await bank.connect(user).borrow(ethers.parseEther("980"));
    await oracle.setPrice(ethers.parseUnits("300", 8));
    await ethers.provider.send("evm_increaseTime", [SECONDS_PER_YEAR * 30]);
    await ethers.provider.send("evm_mine", []);

    const hf = await bank.getHealthFactor(user.address);
    const debt = await bank.getTotalDebt(user.address);
    console.log("💥 Health Factor before liquidation:", hf.toString());
    console.log("📊 Debt before liquidation:", debt.toString());

    const allowance = await miniDai.allowance(liquidator.address, await bank.getAddress());
    const balance = await miniDai.balanceOf(liquidator.address);
    console.log("🧾 liquidator allowance:", allowance.toString());
    console.log("💰 liquidator balance:", balance.toString());

    await miniDai.mint(liquidator.address, ethers.parseEther("500"));
    await miniDai.connect(liquidator).approve(await bank.getAddress(), ethers.parseEther("500"));
    await bank.connect(liquidator).liquidate(user.address, ethers.parseEther("500"));

    const afterHF = await bank.getHealthFactor(user.address);
    console.log("✅ Health Factor after liquidation:", afterHF.toString());
    expect(afterHF).to.be.greaterThan(0);
  });

  it("should repay and clear debt", async () => {
    await bank.connect(user).depositCollateral({ value: ethers.parseEther("1") });
    await bank.connect(user).borrow(ethers.parseEther("980"));
    await ethers.provider.send("evm_increaseTime", [SECONDS_PER_YEAR * 30]);
    await ethers.provider.send("evm_mine", []);

    const { principal, interest } = await bank.getUserDebt(user.address);
    const totalBN = ethers.toBigInt(principal) + ethers.toBigInt(interest) + ethers.parseEther("1");
    console.log("📊 Principal:", principal.toString());
    console.log("📊 Interest:", interest.toString());
    console.log("📊 Total Repay Amount:", totalBN.toString());

    await miniDai.mint(user.address, totalBN);
    await miniDai.connect(user).approve(await bank.getAddress(), totalBN);
    await bank.connect(user).repay(totalBN);

    const debt = await bank.getTotalDebt(user.address);
    console.log("✅ Remaining Debt:", debt.toString());
    expect(debt).to.be.lessThanOrEqual(ethers.parseUnits("0.01", 18));
  });

  it("should restrict withdrawCollateral if HF < 1", async () => {
    await bank.connect(user).depositCollateral({ value: ethers.parseEther("1") });
    await bank.connect(user).borrow(ethers.parseEther("800"));
    await ethers.provider.send("evm_increaseTime", [SECONDS_PER_YEAR * 30]);
    await ethers.provider.send("evm_mine", []);
    await oracle.setPrice(ethers.parseUnits("500", 8));

    const hf = await bank.getHealthFactor(user.address);
    console.log("⚠️ Health Factor before withdraw:", hf.toString());

    await expect(
      bank.connect(user).withdrawCollateral(ethers.parseEther("0.5"))
    ).to.be.revertedWith("Undercollateralized");
  });
});
