const { expect } = require("chai");
const { ethers } = require("hardhat");

const ONE_ETHER = 10n ** 18n;

describe("BankV3 - 兩位 LP + 一人清算並領獎", function () {
  let deployer, lp1, lp2, borrower;
  let bank, miniDai, oracle, aMDAI, bankToken;

  beforeEach(async function () {
    [deployer, lp1, lp2, borrower] = await ethers.getSigners();

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

    for (const lp of [lp1, lp2]) {
      await miniDai.mint(lp.address, ethers.parseUnits("1000", 18));
      await miniDai.connect(lp).approve(bank.getAddress(), ethers.parseUnits("1000", 18));
      await bank.connect(lp).supply(ethers.parseUnits("1000", 18));
    }

    await bank.connect(borrower).depositCollateral({ value: ethers.parseEther("2") });
    await bank.connect(borrower).borrow(ethers.parseUnits("1000", 18));
    await oracle.setPrice(ethers.parseUnits("449", 8));

    await miniDai.mint(lp1.address, ethers.parseUnits("1000", 18));
    await miniDai.connect(lp1).approve(bank.getAddress(), ethers.parseUnits("1000", 18));
  });

  it("LP1 清算 borrower 並領取 BKT 獎勳與檢查清算結果", async function () {
    
    const repayAmount = ethers.parseUnits("400", 18);
    // ✅ 模擬時間經過 1 小時讓利息產生
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine");

    // ✅ 除錯：查看 borrower 當前債務與利息
    const [principalBefore, interestBefore] = await bank.getUserDebt(borrower.address);
    console.log("\n🧪 getUserDebt()");
    console.log("principal:", ethers.formatUnits(principalBefore, 18));
    console.log("interest:", ethers.formatUnits(interestBefore, 18));
    
    const debtBefore = await bank.totalDebtCached();
    const colBefore = await bank.collateral(borrower.address);
    const lp1BKTBefore = await bankToken.balanceOf(lp1.address);
    const lp1aMDAI = await aMDAI.balanceOf(lp1.address);
    const lp1ETHBefore = await ethers.provider.getBalance(lp1.address);

    console.log("\n📋 初始狀態:");
    console.log("LP1 aMDAI:", ethers.formatUnits(lp1aMDAI, 18));
    console.log("Borrower 債務:", ethers.formatUnits(debtBefore, 18));
    console.log("Borrower 抵押:", ethers.formatEther(colBefore));

    const lp1MDAI = await miniDai.balanceOf(lp1.address);
    console.log("💵 LP1 mDAI 餘額:", ethers.formatUnits(lp1MDAI, 18));

    const tx = await bank.connect(lp1).liquidate(borrower.address, repayAmount);
    const receipt = await tx.wait();

    const iface = bank.interface;
    const logs = receipt.logs.map(log => {
      try {
        return iface.parseLog(log);
      } catch {
        return null;
      }
    }).filter(Boolean);

    const repayLog = logs.find(e => e.name === "RepaidDetailed");
    expect(repayLog).to.not.be.undefined;

    const [user, burned, toLP, toProtocol] = repayLog.args;
    console.log("\n📊 RepaidDetailed Log:");
    console.log("清算對象:", user);
    console.log("燒掉本金:", ethers.formatUnits(burned, 18));
    console.log("分給 LP:", ethers.formatUnits(toLP, 18));
    console.log("分給協議:", ethers.formatUnits(toProtocol, 18));

    const liquidationLog = logs.find(e => e.name === "Liquidated");
    if (liquidationLog) {
      const [, , seized] = liquidationLog.args;
      console.log("🧾 Liquidation Event - seized ETH:", ethers.formatEther(seized));
    }

    const colAfter = await bank.collateral(borrower.address);
    const debtAfter = (await bank.debts(borrower.address)).principal;
    console.log("\n📉 borrower 清算後:");
    console.log("剩餘債務:", ethers.formatUnits(debtAfter, 18));
    console.log("剩餘抵押:", ethers.formatEther(colAfter));
    console.log("實際剩餘抵押 (wei):", colAfter.toString());

    const seizedWei = BigInt(ethers.parseEther("2").toString()) - BigInt(colAfter.toString());
    console.log("實際被清算掉的抵押 ETH:", ethers.formatEther(seizedWei.toString()));

    const lp1ETHAfter = await ethers.provider.getBalance(lp1.address);
    console.log("💰 LP1 ETH 收益:", ethers.formatEther(lp1ETHAfter - lp1ETHBefore));

    const reserveFactor = await bank.reserveFactor();
    const bonusPercent = await bank.BONUS_PERCENT();
    console.log("Reserve Factor (%):", reserveFactor.toString());
    console.log("Bonus Percent (%):", bonusPercent.toString());

    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine");

    await bank.connect(lp1).claimReward(true);
    const lp1BKTAfter = await bankToken.balanceOf(lp1.address);
    console.log("\n🎖️ LP1 領取 BKT:", ethers.formatUnits(lp1BKTAfter - lp1BKTBefore, 18));

    const lp2aMDAI = await aMDAI.balanceOf(lp2.address);
    const lp1BKT = await bankToken.balanceOf(lp1.address);
    const lp2BKT = await bankToken.balanceOf(lp2.address);

    const totalSupply = await aMDAI.totalSupply();
    const lp1Share = lp1aMDAI * 10000n / BigInt(totalSupply);
    const lp2Share = lp2aMDAI * 10000n / BigInt(totalSupply);

    console.log("\n💼 LP 資產狀態:");
    console.log("LP1 aMDAI:", ethers.formatUnits(lp1aMDAI, 18), `(佔比 ${lp1Share / 100n}% )`);
    console.log("LP2 aMDAI:", ethers.formatUnits(lp2aMDAI, 18), `(佔比 ${lp2Share / 100n}% )`);
    console.log("LP1 BKT:", ethers.formatUnits(lp1BKT, 18));
    console.log("LP2 BKT:", ethers.formatUnits(lp2BKT, 18));

    const [colUSD, debt, avail] = await bank.getUserAccountData(borrower.address);
    console.log("\n👤 Borrower 帳戶資料:");
    console.log("抵押價值（USD）:", ethers.formatUnits(colUSD, 18));
    console.log("債務（mDAI）:", ethers.formatUnits(debt, 18));
    console.log("可再借貸額度（mDAI）:", ethers.formatUnits(avail, 18));

    expect(debtAfter).to.be.gt(0n);
    expect(colAfter).to.be.lt(ethers.parseEther("2"));
  });
});
