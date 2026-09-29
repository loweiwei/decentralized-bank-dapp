// test/liquidation-lp-test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BankV3 - 清算含 LP 流動性", function () {
  let deployer, borrower, liquidator;
  let bank, miniDai, oracle, aMDAI, bankToken;

  beforeEach(async function () {
    [deployer, borrower, liquidator] = await ethers.getSigners();

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

    // LP 提供流動性
    await miniDai.mint(deployer.address, ethers.parseUnits("2000", 18));
    await miniDai.connect(deployer).approve(bank.getAddress(), ethers.parseUnits("2000", 18));
    await bank.connect(deployer).supply(ethers.parseUnits("2000", 18));

    // 借款人抵押 ETH 並借款
    await bank.connect(borrower).depositCollateral({ value: ethers.parseEther("2") });
    await bank.connect(borrower).borrow(ethers.parseUnits("1000", 18));

    // 模擬 ETH 價格下跌
    await oracle.setPrice(ethers.parseUnits("400", 8));

    // 清算人準備資金
    await miniDai.mint(liquidator.address, ethers.parseUnits("500", 18));
    await miniDai.connect(liquidator).approve(bank.getAddress(), ethers.parseUnits("500", 18));
  });

  it("清算成功，抵押品轉移、LP 獲益、協議 reserve 增加", async function () {
    const repayAmount = ethers.parseUnits("400", 18);

    const poolBefore = await miniDai.balanceOf(await bank.getAddress());
    const reserveBefore = await bank.protocolTokenReserve();
    const collateralBefore = await bank.collateral(borrower.address);
    const debtBefore = await bank.totalDebtCached();
    const aMDAISupplyBefore = await aMDAI.totalSupply();
    const aMDAIValueBefore = poolBefore * ethers.WeiPerEther / aMDAISupplyBefore;

    const tx = await bank.connect(liquidator).liquidate(borrower.address, repayAmount);
    await tx.wait();

    const poolAfter = await miniDai.balanceOf(await bank.getAddress());
    const reserveAfter = await bank.protocolTokenReserve();
    const collateralAfter = await bank.collateral(borrower.address);
    const debtAfter = await bank.totalDebtCached();
    const aMDAISupplyAfter = await aMDAI.totalSupply();
    const aMDAIValueAfter = poolAfter * ethers.WeiPerEther / aMDAISupplyAfter;

    console.log("🧾 清算人付款:", ethers.formatUnits(repayAmount), "mDAI");
    console.log("✅ 協議 reserve 增加:", ethers.formatUnits(reserveAfter - reserveBefore), "mDAI");
    console.log("✅ LP 池增加:", ethers.formatUnits(poolAfter - poolBefore), "mDAI");
    console.log("✅ 借款人抵押品減少:", ethers.formatEther(collateralBefore - collateralAfter), "ETH");
    console.log("✅ 借款人債務減少:", ethers.formatUnits(debtBefore - debtAfter), "mDAI");
    console.log("💹 aMDAI 兌換比提升:", "從", ethers.formatUnits(aMDAIValueBefore, 18), "→", ethers.formatUnits(aMDAIValueAfter, 18));

    expect(poolAfter).to.be.gt(poolBefore);
    expect(reserveAfter).to.be.gt(reserveBefore);
    expect(collateralAfter).to.be.lt(collateralBefore);
    expect(debtAfter).to.be.lt(debtBefore);
    expect(aMDAIValueAfter).to.be.gt(aMDAIValueBefore);
  });
});
