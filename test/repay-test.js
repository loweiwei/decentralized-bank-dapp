const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BankV3 Repay Test", function () {
  let owner, user;
  let bank, miniDai, oracle, bankToken, aMDAI;

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("PriceOracle");
    oracle = await Oracle.deploy();
    await oracle.setPrice(ethers.parseUnits("1000", 8));

    const MiniDAI = await ethers.getContractFactory("MiniDAI");
    miniDai = await MiniDAI.deploy(owner.address);

    const BankToken = await ethers.getContractFactory("BankToken");
    bankToken = await BankToken.deploy(ethers.parseUnits("1000000", 18));

    const AMDAI = await ethers.getContractFactory("aMDAI");
    aMDAI = await AMDAI.deploy();

    const Bank = await ethers.getContractFactory("BankV3");
    bank = await Bank.deploy(
      await miniDai.getAddress(),
      await oracle.getAddress(),
      owner.address,
      await bankToken.getAddress(),
      await aMDAI.getAddress()
    );

    await miniDai.setMinter(await bank.getAddress());
    await bankToken.transfer(await bank.getAddress(), ethers.parseUnits("200000", 18));
    await aMDAI.setBank(await bank.getAddress());

    // owner 鑄幣並轉帳給 user
    const mintAmount = ethers.parseEther("10000");
    const transferAmount = ethers.parseEther("1000");
    await miniDai.mint(owner.address, mintAmount);
    await miniDai.transfer(user.address, transferAmount);

    // owner 提供 1000 MiniDAI 流動性
    const supplyAmount = ethers.parseEther("1000");
    await miniDai.connect(owner).approve(await bank.getAddress(), supplyAmount);
    await bank.connect(owner).supply(supplyAmount);

    // user 抵押 1 ETH
    await bank.connect(user).depositCollateral({ value: ethers.parseEther("1") });

    // user 借出 800 MiniDAI
    const borrowAmount = ethers.parseEther("800");
    await bank.connect(user).borrow(borrowAmount);

    // 快轉 30 秒（模擬利息）
    await ethers.provider.send("evm_increaseTime", [30]);
    await ethers.provider.send("evm_mine");
  });

  it("should split repay into principal, LP, and protocol correctly", async () => {
    const repayAmount = ethers.parseEther("50");

    // approve 還款
    await miniDai.connect(user).approve(await bank.getAddress(), repayAmount);

    // 執行還款
    const tx = await bank.connect(user).repay(repayAmount);
    const receipt = await tx.wait();

    // 擷取事件
    const event = receipt.logs.find(log => log.fragment?.name === "RepaidDetailed");
    expect(event).to.not.be.undefined;

    const [userAddr, burned, toLP, toProtocol] = event.args;

    console.log("\n🧾 還款拆分結果：");
    console.log("🔥 燒掉本金    :", ethers.formatUnits(burned, 18), "MiniDAI");
    console.log("💧 給流動池    :", ethers.formatUnits(toLP, 18), "MiniDAI");
    console.log("🏦 給協議收入 :", ethers.formatUnits(toProtocol, 18), "MiniDAI");

    // 預期：燒掉一些本金 + 給 LP 一些利息 + 給 protocol 一些利息
    expect(burned).to.be.gt(0);
    expect(toLP).to.be.gt(0);
    expect(toProtocol).to.be.gt(0);

    // 驗證總債務是否變少
    const totalDebt = await bank.getTotalDebt(user.address);
    console.log("💳 使用者剩餘債務:", ethers.formatUnits(totalDebt, 18), "MiniDAI");

    expect(totalDebt).to.be.lt(ethers.parseEther("800")); // 原本借 800，應該變少
  });
});
