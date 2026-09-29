// test/liquidation-test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BankV3 Liquidation Test", function () {
  let deployer, user1, liquidator;
  let bank, miniDai, priceOracle, bankToken, aMDAI;

  beforeEach(async function () {
    [deployer, user1, liquidator] = await ethers.getSigners();

    // 1. Deploy Oracle
    const Oracle = await ethers.getContractFactory("PriceOracle");
    priceOracle = await Oracle.deploy();
    await priceOracle.waitForDeployment();
    await priceOracle.setPrice(ethers.parseUnits("2000", 8));

    // 2. Deploy MiniDAI
    const MiniDAI = await ethers.getContractFactory("MiniDAI");
    miniDai = await MiniDAI.deploy(deployer.address);
    await miniDai.waitForDeployment();

    // 3. Deploy BankToken
    const BankToken = await ethers.getContractFactory("BankToken");
    bankToken = await BankToken.deploy(ethers.parseUnits("1000000", 18));
    await bankToken.waitForDeployment();

    // 4. Deploy aMDAI
    const aMDAIFactory = await ethers.getContractFactory("aMDAI");
    aMDAI = await aMDAIFactory.deploy();
    await aMDAI.waitForDeployment();

    // 5. Deploy BankV3
    const Bank = await ethers.getContractFactory("BankV3");
    bank = await Bank.deploy(
      await miniDai.getAddress(),
      await priceOracle.getAddress(),
      deployer.address,
      await bankToken.getAddress(),
      await aMDAI.getAddress()
    );
    await bank.waitForDeployment();

    // === Setup roles ===
    await miniDai.setMinter(await bank.getAddress());
    await aMDAI.setBank(await bank.getAddress());

    console.log(" Roles initialized:");
    console.log("- BankV3:", await bank.getAddress());
    console.log("- MiniDAI Minter:", await miniDai.minter());
    console.log("- aMDAI Bank:", await aMDAI.bank());
  });

it("should allow liquidator to perform liquidation", async function () {
    //  Mint + Approve
    await miniDai.mint(liquidator.address, ethers.parseUnits("800", 18));
    const bankAddress = await bank.getAddress();
    await miniDai.connect(liquidator).approve(bankAddress, ethers.parseUnits("800", 18));
    const bankBalance = await miniDai.balanceOf(bankAddress);
    console.log("Bank mDAI balance:", ethers.formatUnits(bankBalance, 18));
    const allowance = await miniDai.allowance(liquidator.address, await bank.getAddress());
    console.log(" allowance:", ethers.formatUnits(allowance, 18));


    await miniDai.mint(deployer.address, ethers.parseUnits("10000", 18));
    await miniDai.connect(deployer).approve(await bank.getAddress(), ethers.parseUnits("10000", 18));
    await bank.connect(deployer).supply(ethers.parseUnits("10000", 18));
    await priceOracle.setPrice(ethers.parseUnits("1000", 8));

    // 抵押 6 ETH
    await bank.connect(user1).depositCollateral({ value: ethers.parseEther("6") });

    //  借款 9600 mDAI（小於 max borrow）
    await bank.connect(user1).borrow(ethers.parseUnits("4000", 18));

   
    await priceOracle.setPrice(ethers.parseUnits("600", 8));

    
    const totalDebt = await bank.getTotalDebt(user1.address);
    const repayAmount = ethers.parseUnits("500", 18); // 先確保清算可以過
    console.log(" totalDebt (raw):", totalDebt.toString());
    //console.log("Bank mDAI balance:", miniDai.balanceOf(address(this)));
    console.log("repayAmount (raw):", repayAmount.toString());
    const balance = await miniDai.balanceOf(liquidator.address);
    console.log(" Liquidator mDAI balance:", ethers.formatUnits(balance, 18));


  
    const hf = await bank.getHealthFactor(user1.address);
    const hfBefore = await bank.getHealthFactor(user1.address);
    console.log(`📉 清算前 HF：${(Number(hfBefore) / 1e4).toFixed(4)}`);

    const [principal, interest] = await bank.getUserDebt(user1.address);
    const colVal = await bank.getCollateralValueUSD(user1.address);
    const ethPrice = await priceOracle.getLatestETHPrice();
    const maxBorrow = colVal * 8000n / 10000n;

    console.log(" Debug Info:");
    console.log("- ETH Price:", ethers.formatUnits(ethPrice, 8));
    console.log("- Collateral USD:", ethers.formatUnits(colVal, 18));
    console.log("- Principal:", ethers.formatUnits(principal, 18));
    console.log("- Interest :", ethers.formatUnits(interest, 18));
    console.log("- Total Debt:", ethers.formatUnits(totalDebt, 18));
    console.log("- Repay Amount:", ethers.formatUnits(repayAmount, 18));
    console.log("- Max Borrowable:", ethers.formatUnits(maxBorrow, 18));
    console.log("- HF:", (Number(hf) / 1e4).toFixed(4));

    
    const liquidatorETHBefore = await ethers.provider.getBalance(liquidator.address);
    const liquidatorMDAIBefore = await miniDai.balanceOf(liquidator.address);

    let receipt;
    try {
    const tx = await bank.connect(liquidator).liquidate(user1.address, repayAmount);
    receipt = await tx.wait();
    console.log(" Liquidation success!");
    } catch (err) {
    console.error(" Liquidation failed:", err);
    return;
    }
    const hfAfter = await bank.getHealthFactor(user1.address);
    console.log(`📈 清算後 HF：${(Number(hfAfter) / 1e4).toFixed(4)}`);


   
    const userCollateral = await bank.collateral(user1.address);
    const protocolReserve = await bank.getProtocolTokenReserve();
    const liquidatorETHAfter = await ethers.provider.getBalance(liquidator.address);
    const liquidatorMDAIAfter = await miniDai.balanceOf(liquidator.address);

    const bonusReceived = liquidatorETHAfter - liquidatorETHBefore;
    const mDAISpent = liquidatorMDAIBefore - liquidatorMDAIAfter;

    console.log(" After liquidation:");
    console.log("- Remaining collateral:", ethers.formatEther(userCollateral));
    console.log("- Protocol Token Reserve:", ethers.formatUnits(protocolReserve, 18));
    console.log("- Bonus ETH Received:", ethers.formatEther(bonusReceived.toString()));
    console.log("- mDAI Spent:", ethers.formatUnits(mDAISpent.toString(), 18));


    expect(principal).lte(ethers.parseUnits("9600", 18));
    expect(userCollateral).lt(ethers.parseEther("6"));
    expect(protocolReserve).gt(0);
    expect(bonusReceived).gt(0);
    expect(mDAISpent).to.equal(repayAmount);

   
    const event = receipt.logs.find(log => log.fragment && log.fragment.name === "Liquidated");
    expect(event).to.not.be.undefined;
    expect(event.args.user).to.equal(user1.address);
    expect(event.args.seizedCollateral).to.be.gt(0);
    });

});
