// SPDX-License-Identifier: MIT

let provider, signer, account;
let bankV3Contract, miniDaiContract, priceOracleContract;
let bankTokenContract, bankGovernorContract;
let aMDAIContract;
let isConnecting = false, isProcessing = false;

// 合約地址與 ABI
let bankV3Address, miniDaiAddress, priceOracleAddress;
let bankTokenAddress, governorAddress, aMDAIAddress;

// === 錢包連接與合約載入 ===
  async function connectWallet() {
    if (isConnecting) return;
    isConnecting = true;
    try {
      if (!window.ethereum) return alert("請先安裝 MetaMask");
      await window.ethereum.request({ method: "eth_requestAccounts" });
      provider = new ethers.BrowserProvider(window.ethereum);
      signer = await provider.getSigner();
      account = await signer.getAddress();
      document.getElementById("account").innerText = `已連接：${account}`;
      await loadContracts();
      await loadGovernanceContracts();
      await loadTimelockContract();

      await updateAll();

      // ✅ 定時每 10 秒同步資料
      setInterval(updateUnclaimedReward, 10000);
      setInterval(updateLPInfo, 10000);

      // ✅ 可選：其他 update 也可以定期更新，例如利率、總儲量等
      // setInterval(updateRewardParams, 60000); // 每分鐘更新參數
    } catch (err) {
      alert("連接失敗: " + (err?.message || err?.reason || "未知錯誤"));
    } finally {
      isConnecting = false;
    }

    if (window.ethereum && !window.ethereum.__connectedOnce) {
      window.ethereum.on("accountsChanged", connectWallet);
      window.ethereum.__connectedOnce = true;
    }
  }
  async function loadContracts() {
    const addresses = await fetch("contract-address.json").then(r => r.json());
    const [bankV3Art, miniArt, oracleArt, aMDAIArt] = await Promise.all([
      fetch("BankV3.json").then(r => r.json()),
      fetch("MiniDAI.json").then(r => r.json()),
      fetch("PriceOracle.json").then(r => r.json()),
      fetch("aMDAI.json").then(r => r.json())
    ]);
    bankV3Address = addresses.BankV3;
    miniDaiAddress = addresses.MiniDAI;
    priceOracleAddress = addresses.PriceOracle;
    aMDAIAddress = addresses.aMDAI;
    bankV3Contract = new ethers.Contract(bankV3Address, bankV3Art.abi, signer);
    miniDaiContract = new ethers.Contract(miniDaiAddress, miniArt.abi, signer);
    priceOracleContract = new ethers.Contract(priceOracleAddress, oracleArt.abi, signer);
    aMDAIContract = new ethers.Contract(aMDAIAddress, aMDAIArt.abi, signer);
  }
  async function loadGovernanceContracts() {
    const addresses = await fetch("contract-address.json").then(res => res.json());
    const tokenArtifact = await fetch("BankToken.json").then(res => res.json());
    const governorArtifact = await fetch("BankGovernor.json").then(res => res.json());
    bankTokenAddress = addresses.BankToken;
    governorAddress = addresses.BankGovernor;
    bankTokenContract = new ethers.Contract(bankTokenAddress, tokenArtifact.abi, signer);
    bankGovernorContract = new ethers.Contract(governorAddress, governorArtifact.abi, signer);
  }
  async function loadTimelockContract() {
    const addresses = await fetch("contract-address.json").then(res => res.json());
    const timelockArtifact = await fetch("BankTimelock.json").then(res => res.json());

    timelockAddress = addresses.BankTimelock;
    bankTimelockContract = new ethers.Contract(timelockAddress, timelockArtifact.abi, signer);

    console.log(" Timelock 合約已載入:", timelockAddress);
  }
  async function safeAction(name, fn) {
    if (isProcessing) return alert("請等待前一筆交易完成");
    try {
      isProcessing = true;
      await fn();
      await updateAll();
    } catch (err) {
      alert(`${name} 失敗: ${err?.message || err?.reason || "未知錯誤"}`);
    } finally {
      isProcessing = false;
    }
  }

// === 資料更新區塊 ===
  async function updateAll() {
    await Promise.all([
      updateETHPriceDisplay(),
      updateFullUserData(),
      updateRewardParams(),
      updateLPInfo(),
      updateVotingInfo(),
      updateQuorumInfo(),
      updateUnclaimedReward(),
    ]);
  }
  async function updateLPInfo() {
    try {
      const balance = await aMDAIContract.balanceOf(account);
      const totalSupply = await aMDAIContract.totalSupply();
      const pool = await bankV3Contract.getTotalSupplied();
      // 查詢當前 aMDAI 兌換比
      const exchangeRate = await bankV3Contract.getExchangeRate(); // 單位是 1e18
      const exchangeRateFormatted = (Number(exchangeRate) / 1e18).toFixed(6);
      document.getElementById("lpInfo").innerHTML = `
        <h3> LP 狀態</h3>
         你的 aMDAI：${ethers.formatUnits(balance, 18)} 顆<br>
         aMDAIContract.totalSupply總供應量：${ethers.formatUnits(totalSupply, 18)} 顆<br>
         liquidityPool流動性池中 mDAI：${ethers.formatUnits(pool, 18)} 顆
         aMDAI 兌換比：${exchangeRateFormatted}<br> 
      `;
    } catch (err) {
      console.error(" 讀取 LP 資訊失敗", err);
    }
  }
  async function updateETHPriceDisplay() {
    const price = await priceOracleContract.getLatestETHPrice();
    const priceValue = ethers.formatUnits(price, 8);
    document.getElementById("ethPriceNow").innerText = `目前價格：${Number(priceValue).toFixed(2)} USD / ETH`;
  }
  async function updateFullUserData() {
    if (!account) return;

    const network = await provider.getNetwork();
    const nativeBalance = await provider.getBalance(account);
    const ethBalance = parseFloat(ethers.formatEther(nativeBalance)).toFixed(6);

    const depositsWei = await bankV3Contract.collateral(account);
    const depositsETH = Number(ethers.formatEther(depositsWei));
    const ethPrice = await bankV3Contract.getCurrentETHPrice();
    const ethPriceUSD = Number(ethers.formatUnits(ethPrice, 8));
    const collateralUSD = (depositsETH * ethPriceUSD).toFixed(2);

    const [_, debt, availableToBorrow] = await bankV3Contract.getUserAccountData(account);
    const debtValue = Number(ethers.formatUnits(debt, 18)).toFixed(2);
    const availableValue = Number(ethers.formatUnits(availableToBorrow, 18)).toFixed(2);

    // 🔐 健康因子處理
    // 🔐 健康因子處理
      let healthFactor = "N/A";
      let healthFactorClass = "text-gray-400";

      try {
      const factor = await bankV3Contract.getHealthFactor(account);

      if (factor === ethers.MaxUint256) {
          healthFactor = `∞ 極安全`;
          healthFactorClass = "text-green-500";
      } else {
          const hfRaw = Number(factor); // HF 是 4-decimals 格式（×1e4）
          const hf = (hfRaw / 1e4).toFixed(2);
          const hfValue = parseFloat(hf);

          if (hfValue >= 2.0) {
          healthFactor = `${hf} ✅ 安全`;
          healthFactorClass = "text-green-500";
          } else if (hfValue >= 1.0) {
          healthFactor = `${hf} ⚠️ 注意`;
          healthFactorClass = "text-yellow-500";
          } else {
          healthFactor = `${hf} 🚨 危險`;
          healthFactorClass = "text-red-500";
          }
      }
      } catch (err) {
      console.warn("❌ Health Factor 讀取失敗", err);
      healthFactor = "錯誤 ❌";
      healthFactorClass = "text-red-500";
      }


    let maxWithdrawableETH = "查詢失敗";
    try {
      const maxWithdraw = await bankV3Contract.getMaxWithdrawableETH(account);
      maxWithdrawableETH = parseFloat(ethers.formatEther(maxWithdraw)).toFixed(6);
    } catch {}

    let principal = 0n, interest = 0n, interestRate = 0;
    let principalValue = "0.00", interestValue = "0.0000", interestRateValue = "0.00";
    let previewInterest = 0n;
    let previewInterestValue = "0.00000000";  // ✅ 加這行預設值

    try {
      [principal, interest] = await bankV3Contract.getUserDebt(account);
      interestRate = await bankV3Contract.getInterestRate();
      previewInterest = await bankV3Contract.previewInterest(account);

      principalValue = Number(ethers.formatUnits(principal, 18)).toFixed(2);
      interestValue = Number(ethers.formatUnits(interest, 18)).toFixed(8); // ✅ 改這裡
      previewInterestValue = Number(ethers.formatUnits(previewInterest, 18)).toFixed(8);
      interestRateValue = (Number(interestRate) / 100).toFixed(2);
      totalDebtValue = (Number(ethers.formatUnits(debt, 18)) + Number(ethers.formatUnits(interest, 18))).toFixed(6);

      
      console.log("🧪 利息更新：", interest.toString(), "→ $", interestValue);
    } catch {}

    let liquidationPrice = "無需清算";
    try {
      const price = await bankV3Contract.getLiquidationPrice(account);
      if (price > 0) liquidationPrice = `$${(Number(price) / 1e8).toFixed(2)} USD`;
    } catch {}

    let protocolTokenReserve = "載入中...";

    try {
      const tokenReserve = await bankV3Contract.getProtocolTokenReserve();
      const rawToken = ethers.formatUnits(tokenReserve, 18);
      protocolTokenReserve = ethers.commify(Number(rawToken).toFixed(2)) + " mDAI";
    } catch (err) {
      console.error("取得儲備金失敗：", err);
    }

    // 🔁 動態注入畫面（加 span 給 Health Factor 變色用）
    document.getElementById("userInfo").innerHTML = `
      <h3> 用戶資訊</h3>
      🪙 錢包 ETH 餘額：${ethBalance} ETH<br>
       抵押 ETH 數量：${depositsETH.toFixed(6)} ETH（約 $${collateralUSD}）<br>
       借款總額：$${debtValue}<br>
       利息累積：$${interestValue}（年利率 ${interestRateValue}%）<br>
       應還款總額（本金＋利息）：$${totalDebtValue} mDAI<br>
       可借貸金額：$${availableValue}<br>
       安全因子（Health Factor）：<span class="${healthFactorClass}">${healthFactor}</span><br>
       可提取 ETH：${maxWithdrawableETH} ETH<br>
       預測清算價格：${liquidationPrice}<br>
       協議儲備金（mDAI）：${protocolTokenReserve}
    `;
  }

  //  自動從 CollateralDeposited 事件取得歷史抵押用戶地址
  async function getActiveUsersFromEvents() {
    const filter = bankV3Contract.filters.CollateralDeposited();
    const events = await bankV3Contract.queryFilter(filter, 0, "latest");

    // 取出所有曾經抵押的 address（去重）
    const addresses = [...new Set(events.map(e => e.args.user))];
    return addresses;
  }

  async function fetchLiquidatableUsers() {
    const listEl = document.getElementById("liquidatableList");
    listEl.innerHTML = "<li>查詢中...</li>";

    try {
      const threshold = await bankV3Contract.LIQUIDATION_THRESHOLD(); // 例如 9000（代表 HF < 0.9 可清算）
      const users = await getActiveUsersFromEvents();

      const results = [];

      for (const user of users) {
        try {
          const hf = await bankV3Contract.getHealthFactor(user);
          if (hf < threshold) {
            const debt = await bankV3Contract.getTotalDebt(user);
            const hfVal = (Number(hf.toString()) / 1e4).toFixed(2);
            const debtVal = Number(ethers.formatUnits(debt, 18)).toFixed(4);
            results.push(`<li>${user}：🚨 HF=${hfVal}，債務=${debtVal} mDAI</li>`);
          }
        } catch (e) {
          console.warn(`❌ 查詢 ${user} 失敗`, e);
        }
      }

      listEl.innerHTML = results.length
        ? results.join("")
        : "<li>目前無可清算帳戶 ✅</li>";
    } catch (err) {
      console.error("❌ 清算列表錯誤", err);
      listEl.innerHTML = "<li>讀取失敗 ❌</li>";
    }
  }

  async function fetchProposalList() {
    const proposalListEl = document.getElementById("proposalHistoryList");
    if (!proposalListEl) return;

    const filter = bankGovernorContract.filters.ProposalCreated();
    const events = await bankGovernorContract.queryFilter(filter);

    // 解析所有 calldata 的 function signature
    const iface = new ethers.Interface([
      "function setInterestRate(uint256)",
      "function setDailyCap(uint256)",
      "function withdrawETHReserve(address,uint256)",
      "function setGovernance(address)",
      "function setProposalThreshold(uint256)",
      "function setQuorumPercent(uint256)",
      "function injectProtocolEarningsToLP(uint256)",
      "function setRewardRatio(uint256)",
      "function setLPRewardRatio(uint256)",
      "function setBorrowerRewardRatio(uint256)",
      "function setReserveFactor(uint256)",
      "function lockGovernance()"
    ]);

    const items = await Promise.all(events.map(async (e) => {
      const id = e.args.proposalId;
      const proposer = e.args.proposer;
      const desc = e.args.description;
      const stateNum = await bankGovernorContract.state(id);
      const stateName = getProposalStateName(stateNum);

      // 處理每一筆 call
      let calls = "";
      for (let i = 0; i < e.args.targets.length; i++) {
        const target = e.args.targets[i];
        const calldata = e.args.calldatas[i];

        let decoded = "";
        let fnName = "";
        try {
          const parsed = iface.parseTransaction({ data: calldata });
          fnName = parsed.name;
          decoded = parsed.args.map(arg => arg.toString()).join(", ");
        } catch (err) {
          fnName = "⚠️ 無法辨識";
          decoded = "⚠️ 無法解碼";
        }

        calls += `<li>📦 ${shorten(target)} → <code>${fnName}(...)</code><br>🧬 Args: ${decoded}</li>`;
      }

      return `<li style="margin-bottom: 1em;">
        🔹 <strong>${stateName}</strong>｜🆔 <code>#${id}</code><br>
        🙋‍♂️ 提案人：${shorten(proposer)}<br>
        📝 ${desc}
        <ul>${calls}</ul>
      </li>`;
    }));

    proposalListEl.innerHTML = items.reverse().join("\n");
  }

  // 將狀態數值轉換為文字
  function shorten(addr) {
    return addr.slice(0, 6) + "..." + addr.slice(-4);
  }
  function getProposalStateName(state) {
    const states = [
      "Pending", "Active", "Canceled", "Defeated",
      "Succeeded", "Queued", "Expired", "Executed"
    ];
    return states[state] || "Unknown";
  }


  async function updateVotingInfo() {
      if (!bankTokenContract || !bankGovernorContract || !account) return;
      const balance = await bankTokenContract.balanceOf(account);
      const votes = await bankTokenContract.getVotes(account);
      const threshold = await bankGovernorContract.proposalThreshold();
      const canPropose = votes >= threshold;
      document.getElementById("votingInfo").innerHTML = `
      <h3>🧠 DAO 投票資訊</h3>
      BankToken 餘額：${ethers.formatUnits(balance, 18)} BKT<br>
      擁有投票權：${ethers.formatUnits(votes, 18)} BKT<br>
      提案門檻：${ethers.formatUnits(threshold, 18)} BKT<br>
      ${canPropose ? "✅ 可發起提案" : "❌ 無法發起提案"}
      `;
  }
  async function updateQuorumInfo() {
    const blockNumber = await provider.getBlockNumber();
    const lastBlock = blockNumber - 1;
    const totalVotes = await bankGovernorContract.quorum(lastBlock);

    const formatted = Math.round(Number(ethers.formatUnits(totalVotes, 18))).toLocaleString();

    document.getElementById("quorumInfo").innerHTML = `
      🧾 提案有效門檻：至少 ${formatted} 票
    `;
  }
  async function updateRewardParams() {
    console.log("✅ 自動更新獎勳觸發！");

    if (!bankV3Contract) return;

    const [lpRatio, borrowerRatio, cap, reserve] = await Promise.all([
      bankV3Contract.lpRewardRatio(),
      bankV3Contract.borrowerRewardRatio(),
      bankV3Contract.dailyCap(),
      bankV3Contract.reserveFactor(),
    ]);

    const lpRatioFormatted = ethers.formatUnits(lpRatio, 18);           // 每秒每 USD 發幣 (LP)
    const borrowerRatioFormatted = ethers.formatUnits(borrowerRatio, 18); // 每秒每 USD 發幣 (Borrower)
    const capFormatted = ethers.formatUnits(cap, 18);                   // 每日發幣上限
    const reservePercent = (Number(reserve) / 10000 * 100).toFixed(1);  // % 顯示

    document.getElementById("rewardInfo").innerHTML = `
      <h3>獎勵參數</h3>
      💧 <strong>LP</strong> 每秒每 USD 可得：<strong>${lpRatioFormatted}</strong> BKT<br>
      🏦 <strong>Borrower</strong> 每秒每 USD 可得：<strong>${borrowerRatioFormatted}</strong> BKT<br>
      📅 每日發幣上限：<strong>${capFormatted}</strong> BKT<br>
      📈 協議收入比例（Reserve Factor）：<strong>${reservePercent}%</strong>
    `;
  }
  async function updateUnclaimedReward() {
    if (!account || !bankV3Contract) return;

    try {
      const [lp, borrower] = await Promise.all([
        bankV3Contract.getPendingReward(account, true),   // 👈 改這行
        bankV3Contract.getPendingReward(account, false),  // 👈 改這行
      ]);

      const [lpCapped, borrowerCapped] = await Promise.all([
        bankV3Contract.getRewardPreviewCapped(account, true),
        bankV3Contract.getRewardPreviewCapped(account, false),
      ]);
      const [cap, todayDistributed] = await Promise.all([
        bankV3Contract.dailyCap(),
        bankV3Contract.distributedToday(),
      ]);

      document.getElementById("unclaimedLP").innerText =
        `${ethers.formatUnits(lp, 18)} BKT（可領：${ethers.formatUnits(lpCapped, 18)}）`;
      document.getElementById("unclaimedBorrower").innerText =
        `${ethers.formatUnits(borrower, 18)} BKT（可領：${ethers.formatUnits(borrowerCapped, 18)}）`;

      // 顯示發幣上限提示
      document.getElementById("rewardCapWarning").innerText =
        todayDistributed >= cap ? "⚠️ 今日已達每日發幣上限，請明日再領取" : "";
    } catch (err) {
      console.error("❌ 查詢失敗", err);
      document.getElementById("unclaimedLP").innerText = "查詢失敗 ❌";
      document.getElementById("unclaimedBorrower").innerText = "查詢失敗 ❌";
      document.getElementById("rewardCapWarning").innerText = " 查詢獎勵資料時發生錯誤";
    }
  }
  


// === 借貸與抵押功能 ===
  async function depositETH() {
    await safeAction("存入 ETH", async () => {
      const amount = document.getElementById("depositAmount").value;
      if (!amount || isNaN(amount)) throw new Error("請輸入正確的數量");
      const tx = await bankV3Contract.depositCollateral({ value: ethers.parseEther(amount) });
      await tx.wait();
    });
  }
  async function borrow() {
    const amount = document.getElementById("borrowAmount").value;
    const parsedAmount = ethers.parseUnits(amount, 18);

    console.log("📊 Debug 借款前資料");

    const userDebt = await bankV3Contract.getUserDebt(account);
    const collateralValue = await bankV3Contract.getCollateralValueUSD(account);
    const ethPrice = await bankV3Contract.getCurrentETHPrice();
    const LTV = await bankV3Contract.LTV();
    const liquidity = await bankV3Contract.getTotalSupplied();
    const accountData = await bankV3Contract.getUserAccountData(account);
    const collateralUSD = accountData[0];
    const currentDebt = accountData[1];
    const maxBorrow = accountData[2];

    console.log("🧾 借款 Debug 資訊開始");
    console.log("你要借 parsedAmount:", ethers.formatUnits(parsedAmount, 18), "mDAI");
    console.log("你目前本金 userDebt.principal:", ethers.formatUnits(userDebt[0], 18), "mDAI");
    console.log("你目前利息 userDebt.interest:", ethers.formatUnits(userDebt[1], 18), "mDAI");
    console.log("你目前抵押品價值 (USD):", ethers.formatUnits(collateralUSD, 18));
    console.log("你目前債務總額 (USD):", ethers.formatUnits(currentDebt, 18));
    console.log("你最多可以借 maxBorrow:", ethers.formatUnits(maxBorrow, 18), "mDAI");
    console.log("ETH 價格 (USD):", Number(ethPrice) / 1e8);
    console.log("LTV 限制:", LTV);
    console.log("流動性池餘額:", ethers.formatUnits(liquidity, 18), "mDAI");
    console.log("🧾 借款 Debug 資訊結束");

    await safeAction("借出 mDAI", async () => {
      const tx = await bankV3Contract.borrow(parsedAmount);
      await tx.wait();
    });
  }
  async function repay() {
    await safeAction("償還 mDAI", async () => {
      const amount = ethers.parseUnits(document.getElementById("repayAmount").value, 18);
      await miniDaiContract.approve(bankV3Address, amount);
      const tx = await bankV3Contract.repay(amount);
      await tx.wait();
    });
  }
  async function repayAll() {
    await safeAction("一鍵還清", async () => {
      const [principal, interest] = await bankV3Contract.getUserDebt(account);

      const totalDebt = principal + interest;
      if (totalDebt === 0n) {
        return alert("✅ 你已無債務");
      }

      // 加入 buffer 防止 dust
      const buffer = ethers.parseUnits("0.01", 18); // 可調整
      const total = totalDebt + buffer;

      // ✅ 先 approve 再 repay
      await miniDaiContract.approve(bankV3Address, total);
      const tx = await bankV3Contract.repay(total);
      await tx.wait();

      alert("✅ 成功一次還清！（含少量 buffer）");
    });
  }
  async function withdrawCollateral() {
    await safeAction("提取 ETH", async () => {
      let amount = ethers.parseEther(document.getElementById("withdrawAmount").value);
      if (amount > 1n) amount -= 1n;
      const tx = await bankV3Contract.withdrawCollateral(amount);
      await tx.wait();
    });
  }

// === 清算功能 ===
  /*async function estimateMaxLiquidateUI() {
    const user = document.getElementById("liquidateUser").value;
    if (!user) return alert("請輸入清算對象地址");

    try {
      const maxRepay = await bankV3Contract.estimateMaxLiquidate(user);

      // ✅ 格式化為 mDAI 數值（保留 6 位小數）
      const formatted = Number(ethers.formatUnits(maxRepay, 18)).toFixed(6);

      // ✅ 填入 input 欄位
      document.getElementById("liquidateAmount").value = maxRepay.toString(); // 合約呼叫用 raw
      document.getElementById("maxRepayHint").innerText = `💡 建議最大清償額度：約 ${formatted} mDAI`;
    } catch (err) {
      console.error("❌ 估算清償額度失敗", err);
      alert("估算失敗，請確認地址是否正確或用戶是否可清算");
    }
  }*/
 async function estimateMaxLiquidateUI() {
  const user = document.getElementById("liquidateUser").value;
  if (!user) return alert("請輸入清算對象地址");

  try {
    const maxRepay = await bankV3Contract.estimateMaxLiquidate(user);
    const formatted = Number(ethers.formatUnits(maxRepay, 18)).toFixed(6);
    document.getElementById("liquidateAmount").value = maxRepay.toString();
    document.getElementById("maxRepayHint").innerText = ` 建議最大清償額度：約 ${formatted} mDAI`;

    // 🔍 抓價格、參數
    const ethPriceRaw = await priceOracleContract.getLatestETHPrice(); // 8 decimals
    const ethPrice = Number(ethers.formatUnits(ethPriceRaw, 8));

    const reserveFactorRaw = await bankV3Contract.reserveFactor();
    const reserveFactor = Number(reserveFactorRaw.toString());

    const bonusPercentRaw = await bankV3Contract.BONUS_PERCENT();
    const bonusPercent = Number(bonusPercentRaw.toString());

    // 📐 清算報酬計算
    const DECIMALS = 10000;
    const rawRepay = Number(ethers.formatUnits(maxRepay, 18));
    const effectiveRepay = rawRepay * (1 - reserveFactor / DECIMALS);
    const rewardUSD = effectiveRepay * (bonusPercent + DECIMALS) / DECIMALS;
    const seizedETH = rewardUSD / ethPrice;

    alert(` 預估可拿走抵押品：約 ${seizedETH.toFixed(6)} ETH\n📈 Oracle 價格：${ethPrice} USD/ETH\n🏦 協議抽成：${(reserveFactor / 100).toFixed(2)}%\n🎁 清算獎勵：${(bonusPercent / 100).toFixed(2)}%`);
  } catch (err) {
    console.error(" 估算清償額度失敗", err);
    alert("估算失敗，請確認地址是否正確或用戶是否可清算");
  }
}
  async function liquidateUser() {
    await safeAction("清算", async () => {
      const user = document.getElementById("liquidateUser").value;
      const amountRaw = document.getElementById("liquidateAmount").value;
      if (!user || !amountRaw) return alert("請輸入完整資訊");

      const amount = ethers.parseUnits(amountRaw, 18);
      await miniDaiContract.approve(bankV3Address, amount);

      const tx = await bankV3Contract.liquidate(user, amount);
      const receipt = await tx.wait();

      let burnedStr = "0";
      let toLPStr = "0";
      let protocolStr = "0";
      let seizedStr = "0";

      for (const log of receipt.logs) {
        try {
          const parsed = bankV3Contract.interface.parseLog(log);
          if (parsed.name === "RepaidDetailed") {
            burnedStr = parsed.args.burned.toString();
            toLPStr = parsed.args.toLP.toString();
            protocolStr = parsed.args.toProtocol.toString();
          }
          if (parsed.name === "Liquidated") {
            seizedStr = parsed.args.seizedCollateral.toString();
          }
        } catch (e) {}
      }

      const burnedFinal = Number(ethers.formatUnits(burnedStr, 18)).toFixed(6);
      const toLPFinal = Number(ethers.formatUnits(toLPStr, 18)).toFixed(6);
      const protocolFinal = Number(ethers.formatUnits(protocolStr, 18)).toFixed(6);
      const seizedFinal = Number(ethers.formatUnits(seizedStr, 18)).toFixed(6);

      alert(
        ` 成功清算 ${user}\n` +
        ` 燒掉本金：${burnedFinal} mDAI\n` 
      );
    });
  }


  /*async function liquidateUser() {
    await safeAction("清算", async () => {
      const user = document.getElementById("liquidateUser").value;
      const amountRaw = document.getElementById("liquidateAmount").value;
      if (!user || !amountRaw) return alert("請輸入完整資訊");

      const amount = ethers.parseUnits(amountRaw, 18);

      // 授權 mDAI
      await miniDaiContract.approve(bankV3Address, amount);

      // 呼叫清算
      const tx = await bankV3Contract.liquidate(user, amount);
      await tx.wait();

      alert(`✅ 成功清算 ${user}，還了 ${amountRaw} mDAI`);
    });
  }*/
  async function claimRewardBorrower() {
    try {
      const tx = await bankV3Contract.claimReward(false); // 借款人
      await tx.wait();
      alert(" 成功領取借款人獎勳！");
    } catch (err) {
      console.error("❌ 領取失敗：", err);
      alert("❌ 領取失敗：" + (err?.reason || err?.message));
    }
  }
  async function claimRewardLP() {
    try {
      const tx = await bankV3Contract.claimReward(true); // LP
      await tx.wait();
      alert(" 成功領取 LP 獎勳！");
    } catch (err) {
      console.error("❌ 領取失敗：", err);
      alert("❌ 領取失敗：" + (err?.reason || err?.message));
    }
  }


// === 價格模擬功能 ===
  async function simulatePriceChange() {
    await safeAction("模擬價格變動", async () => {
      const input = parseFloat(document.getElementById("ethPriceInput").value);
      const tx = await priceOracleContract.setPrice(BigInt(Math.floor(input * 1e8)));
      await tx.wait();
    });
  }

  
// === DAO 治理功能 ===
//查詢操作
  async function checkProposalState() {
    const idRaw = document.getElementById("statusProposalId_state").value;
    if (!idRaw) return alert("請輸入提案 ID");

    let proposalId;
    try {
      proposalId = BigInt(idRaw);
    } catch {
      return alert("提案 ID 格式錯誤");
    }

    try {
      const state = await bankGovernorContract.state(proposalId);
      const stateMap = {
        0n: "0 - Pending ⏳（尚未開始投票）",
        1n: "1 - Active 🗳️（可投票）",
        2n: "2 - Canceled ❌（已取消）",
        3n: "3 - Defeated 🚫（未通過）",
        4n: "4 - Succeeded ✅（已通過，可排程）",
        5n: "5 - Queued ⏱️（已排程，可執行）",
        6n: "6 - Expired ⌛（逾時未執行）",
        7n: "7 - Executed 🏁（已執行）"
      };

      document.getElementById("proposalStatusResult").innerText =
        "📋 提案狀態：" + (stateMap[state] || `${state} - 未知狀態`);
    } catch (err) {
      console.error("查詢提案狀態錯誤：", err);
      alert("查詢失敗：" + (err.message || "未知錯誤"));
    }
  }
  async function checkProposalVotes() {
    const proposalIdRaw = document.getElementById("statusProposalId_votes").value;
    if (!proposalIdRaw) return alert("請輸入提案 ID");

    let proposalId;
    try {
      proposalId = BigInt(proposalIdRaw);
    } catch {
      return alert("提案 ID 格式錯誤");
    }

    try {
      const snapshot = await bankGovernorContract.proposalSnapshot(proposalId);
      const quorum = await bankGovernorContract.quorum(snapshot);
      const votes = await bankGovernorContract.proposalVotes(proposalId);

      const result = `
          📊 提案票數統計：
          ✅ 支持：${ethers.formatUnits(votes[1], 18)} 票
          ❌ 反對：${ethers.formatUnits(votes[0], 18)} 票
          🤷 棄權：${ethers.formatUnits(votes[2], 18)} 票
          🧾 有效門檻：${ethers.formatUnits(quorum, 18)} 票
      `;
      document.getElementById("proposalVotesResult").innerText = result;
    } catch (err) {
      console.error("❌ 查詢票數失敗", err);
      alert("查詢失敗：" + (err.message || "未知錯誤"));
    }
  }
  async function fetchProposals() {
    const filter = bankGovernorContract.filters.ProposalCreated();
    const events = await bankGovernorContract.queryFilter(filter, 0, "latest");

    // 先取得每個提案的詳細資料
    const proposals = await Promise.all(events.map(async (e) => {
      const id = e.args.id;
      const state = await bankGovernorContract.state(id);
      return {
        id: id.toString(),
        proposer: e.args.proposer,
        desc: e.args.description,
        start: e.args.startBlock,
        end: e.args.endBlock,
        state: state.toString()
      };
    }));

    // 🔧 排序：讓提案 ID 較大的排前面（通常是最新）
    proposals.sort((a, b) => Number(b.id) - Number(a.id));

    const stateMap = {
      "0": "⏳ Pending",
      "1": "🗳️ Active",
      "2": "❌ Canceled",
      "3": "🚫 Defeated",
      "4": "✅ Succeeded",
      "5": "⏱️ Queued",
      "6": "⌛ Expired",
      "7": "🏁 Executed"
    };

    const listHTML = proposals.map(p => `
      <li>
        <strong>#${p.id}</strong> by ${p.proposer}<br>
        📄 ${p.desc}<br>
        🕒 區塊：${p.start} ~ ${p.end}<br>
        📋 狀態：${stateMap[p.state] || p.state}
        <br><button onclick="castVoteOn(${p.id})">投票</button>
      </li>
    `).join("");

    document.getElementById("votingProposalList").innerHTML = `<ul>${listHTML}</ul>`;
  }
  function castVoteOn(proposalId) {
    document.getElementById("proposalId").value = proposalId;
    alert(`已填入 Proposal ID：${proposalId}，請選擇投票選項後點擊投票`);
  }
  async function castVote() {
    const proposalIdStr = document.getElementById("proposalId").value;
    const voteType = parseInt(document.getElementById("voteType").value);

    if (!proposalIdStr || isNaN(voteType)) {
      return alert("請輸入有效的提案 ID 與投票選項");
    }

    let proposalId;
    try {
      proposalId = BigInt(proposalIdStr);
    } catch {
      return alert("❌ 提案 ID 格式錯誤");
    }

    try {
      // ✅ 印出執行前環境資訊
      console.log("🏛️ Governor Contract Address:", await bankGovernorContract.getAddress());
      console.log(" 提案 ID:", proposalId.toString());
      const state = await bankGovernorContract.state(proposalId);
      console.log(" 提案狀態:", state);
      const votingPower = await bankTokenContract.getVotes(account);
      console.log(" Voting Power:", ethers.formatUnits(votingPower, 18));
      console.log(" 當前帳號:", account);
      const totalSupply = await bankTokenContract.totalSupply();
      console.log(" Token TotalSupply:", ethers.formatUnits(totalSupply, 18));

      if (Number(state) !== 1) {
        return alert("❌ 此提案不在投票階段（Active），目前狀態：" + Number(state));
      }

      if (votingPower === 0n) {
        return alert("❌ 你沒有投票權，請先委託 delegate()");
      }

      console.log("📨 正在提交投票：", { proposalId: proposalIdStr, voteType });

      const tx = await bankGovernorContract.castVote(proposalId, voteType);
      await tx.wait();

      alert(" 投票完成！");
    } catch (err) {
      console.error("❌ 投票失敗", err);
      const reason = err?.info?.error?.message || err?.reason || err?.message || "未知錯誤";
      alert("❌ 投票失敗：" + reason);
    }
  }
//Timelock 操作
async function queueProposal() {
  const proposalId = document.getElementById("queueProposalId").value;
  const desc = document.getElementById("queueDescription").value;
  const funcName = document.getElementById("queueFunc").value;
  const funcArgRaw = document.getElementById("queueValue").value;

  if (!proposalId || !desc || !funcName || funcArgRaw === "") {
    return alert("⚠️ 請完整填寫所有欄位");
  }

  const descriptionHash = getDescriptionHash(desc);
  const useParseUnits = ["setBorrowerRewardRatio","setLPRewardRatio", "setDailyCap", "setProposalThreshold", "setMaxTotalDebt","injectProtocolEarningsToLP"];
  const governorFuncs = ["setProposalThreshold", "setQuorumPercent"];

  let funcArg;
  try {
    if (useParseUnits.includes(funcName)) {
      funcArg = ethers.parseUnits(funcArgRaw, 18);
    } else {
      funcArg = parseInt(funcArgRaw);
      if (isNaN(funcArg)) throw new Error("Invalid integer");
    }
  } catch {
    return alert("⚠️ 無法解析參數，請輸入合法數字（整數或小數）");
  }

  const isGovFunc = governorFuncs.includes(funcName);
  const contract = isGovFunc ? bankGovernorContract : bankV3Contract;
  const targetAddress = isGovFunc ? governorAddress : bankV3Address;
  const encoded = contract.interface.encodeFunctionData(funcName, [funcArg]);

  const opHash = await bankTimelockContract.hashOperationBatch(
    [targetAddress],
    [0],
    [encoded],
    ethers.ZeroHash,
    descriptionHash
    );


  const tx = await bankGovernorContract.queue(
    [targetAddress],
    [0],
    [encoded],
    descriptionHash
  );

  const receipt = await tx.wait();

  console.log("🟦 [Queue]");
  console.log("🆔 Proposal ID:", proposalId);
  console.log("📌 targetAddress:", targetAddress);
  console.log("💰 value:", 0);
  console.log("🧮 encoded:", encoded);
  console.log("🧾 descriptionHash:", descriptionHash);
  console.log("🔢 funcArg:", funcArg.toString());
  console.log("🔑 operationHash (opHash):", opHash);

  // 🔍 顯示 TimelockController 的事件（例如 CallScheduled）
  console.log("📜 [Timelock Logs]");
  for (const log of receipt.logs) {
    try {
      const parsed = bankTimelockContract.interface.parseLog(log);
      console.log("✅ Event:", parsed.name, parsed.args);
    } catch (e) {
      // 非 timelock 的 log，略過
    }
  }

  alert("⏳ 已排程提案！");
  await checkOperationScheduled(funcName, funcArgRaw, desc);
}
async function executeProposal() {
  const proposalId = document.getElementById("execProposalId").value;
  const desc = document.getElementById("execDescription").value;
  const funcName = document.getElementById("execFunc").value;
  const funcArgRaw = document.getElementById("execValue").value;

  if (!proposalId || !desc || !funcName || funcArgRaw === "") {
    return alert("⚠️ 請完整填寫所有欄位");
  }

  try {
    const descriptionHash = getDescriptionHash(desc);
    const useParseUnits = ["setBorrowerRewardRatio","setLPRewardRatio", "setDailyCap", "setProposalThreshold", "setMaxTotalDebt","injectProtocolEarningsToLP"];
    const governorFuncs = ["setProposalThreshold", "setQuorumPercent"];

    let funcArg;
    try {
      if (useParseUnits.includes(funcName)) {
        funcArg = ethers.parseUnits(funcArgRaw, 18);
      } else {
        funcArg = parseInt(funcArgRaw);
        if (isNaN(funcArg)) throw new Error("Invalid integer");
      }
    } catch {
      return alert("⚠️ 無法解析參數，請輸入合法數字（整數或小數）");
    }

    const isGovFunc = governorFuncs.includes(funcName);
    const contract = isGovFunc ? bankGovernorContract : bankV3Contract;
    const targetAddress = isGovFunc ? governorAddress : bankV3Address;
    const encoded = contract.interface.encodeFunctionData(funcName, [funcArg]);

    const opHash = await bankTimelockContract.hashOperationBatch(
      [targetAddress],
      [0],
      [encoded],
      ethers.ZeroHash,
      descriptionHash
    );


    const scheduledTime = await bankTimelockContract.getTimestamp(opHash);
    const now = BigInt(Math.floor(Date.now() / 1000));

    console.log("🧮 operationHash:", opHash);
    console.log("⏰ 現在時間：", now);
    console.log("📅 Scheduled Timestamp:", scheduledTime.toString());

    if (Number(scheduledTime) === 0) {
      return alert("❌ 此操作尚未排程，請先 queue");
    }

    if (now < scheduledTime) {
      return alert(`⏱️ Timelock 還沒到時間，請再等 ${scheduledTime - now} 秒`);
    }

    console.log("🟥 [Execute]");
    console.log("📌 targetAddress:", targetAddress);
    console.log("💰 value:", 0);
    console.log("🧮 encoded:", encoded);
    console.log("🧾 descriptionHash:", descriptionHash);
    console.log("🔑 operationHash (opHash):", opHash);
    console.log("⏰ 現在時間：", now);
    console.log("📅 Scheduled Timestamp:", scheduledTime.toString());


    const tx = await bankGovernorContract.execute(
      [targetAddress],
      [0],
      [encoded],
      descriptionHash
    );

    await tx.wait();
    alert("🎉 提案已執行！");
  } catch (err) {
    console.error("❌ 執行失敗", err);
    const reason = err?.info?.error?.message || err?.reason || err?.message || "未知錯誤";
    alert("❌ 執行失敗：" + reason);
  }
}
async function checkOperationScheduled(funcName, funcArgRaw, desc) {
  console.log("🛠️ Debug Start");
  console.log("funcName:", funcName);
  console.log("funcArgRaw:", funcArgRaw);

  const descriptionHash = getDescriptionHash(desc);
  const useParseUnits = ["setBorrowerRewardRatio","setLPRewardRatio", "setDailyCap", "setProposalThreshold", "setMaxTotalDebt","injectProtocolEarningsToLP"];
  const governorFuncs = ["setProposalThreshold", "setQuorumPercent"];

  let funcArg;
  try {
    if (useParseUnits.includes(funcName)) {
      funcArg = ethers.parseUnits(funcArgRaw, 18);
    } else {
      funcArg = parseInt(funcArgRaw);
      if (isNaN(funcArg)) throw new Error();
    }
  } catch {
    return alert("⚠️ funcArg 解析失敗，請輸入合法數字");
  }

  const isGovFunc = governorFuncs.includes(funcName);
  const contract = isGovFunc ? bankGovernorContract : bankV3Contract;
  const targetAddress = isGovFunc ? governorAddress : bankV3Address;
  const encoded = contract.interface.encodeFunctionData(funcName, [funcArg]);

  const opHash = await bankTimelockContract.hashOperationBatch(
    [targetAddress],         // ✅ address[]，必須是 array
    [0],                     // ✅ uint256[]，值也是 array
    [encoded],               // ✅ bytes[]，encoded 也包進 array
    ethers.ZeroHash,
    descriptionHash
  );


  const scheduledTime = await bankTimelockContract.getTimestamp(opHash);
  const now = Math.floor(Date.now() / 1000);
  const isScheduled = await bankTimelockContract.isOperation(opHash);
  const isReady = await bankTimelockContract.isOperationReady(opHash);
  const isDone = await bankTimelockContract.isOperationDone(opHash);

  console.log("🧮 operationHash:", opHash);
  console.log("⏰ 現在時間：", now);
  console.log("📅 Scheduled Timestamp:", scheduledTime.toString());
  console.log("📌 是否已排程：", isScheduled);
  console.log("⌛ 是否可執行：", isReady);
  console.log("🏁 是否已執行：", isDone);

  if (!isScheduled || Number(scheduledTime) === 0) {
    console.warn("❌ 此操作尚未排程（timestamp 為 0）");
  } else if (now < scheduledTime) {
    console.log(`⏳ 還需等待 ${(scheduledTime - now)} 秒`);
  } else {
    console.log("✅ Timelock 時間已到，可以執行！");
  }
}

//投票權委託給自己
async function delegateVotes() {
  const tx = await bankTokenContract.delegate(account);
  await tx.wait();
  await updateVotingInfo(); // ⬅ 放這行

  alert(" 成功委託投票權給自己");
}

function getDescriptionHash(desc) {
  return ethers.keccak256(ethers.toUtf8Bytes(desc.trim()));
}

//---dao提案---
//提交調整利率的提案
  async function proposeChangeInterest() {
    const rate = parseInt(document.getElementById("newInterestRate").value);
    const desc = document.getElementById("proposalDesc").value;

    const encoded = bankV3Contract.interface.encodeFunctionData("setInterestRate", [rate]);
    const target = await bankV3Contract.getAddress();  // ✅
    const tx = await bankGovernorContract.propose([target], [0], [encoded], desc);
    const receipt = await tx.wait();

    alert("✅ 提案成功 ID: " + receipt.logs[0].args.proposalId.toString());
  }
  //提出調整獎勳發放比率的提案
  async function proposeChangeRewardRatio() {
    const ratioRaw = document.getElementById("newRewardRatio").value;
    const newRatio = BigInt(ratioRaw);

    const desc = document.getElementById("proposalDescReward").value;
    if (!desc) return alert("請填寫提案描述");

    const encoded = bankV3Contract.interface.encodeFunctionData("setRewardRatio", [newRatio]);
    const target = await bankV3Contract.getAddress();  // ✅
    const tx = await bankGovernorContract.propose([target], [0], [encoded], desc);
    const receipt = await tx.wait();
    alert(`✅ 提案成功，ID: ${receipt.logs[0].args.proposalId.toString()}`);
  }
  async function proposeSetLPRewardRatio() {
    const ratioRaw = document.getElementById("newLPRewardRatio").value;
    const newRatio = BigInt(ratioRaw);

    const desc = document.getElementById("proposalDescLPReward").value;
    if (!desc) return alert("請填寫提案描述");

    const encoded = bankV3Contract.interface.encodeFunctionData("setLPRewardRatio", [newRatio]);
    const target = await bankV3Contract.getAddress();

    const tx = await bankGovernorContract.propose([target], [0], [encoded], desc);
    const receipt = await tx.wait();

    alert(`✅ LP 發幣提案成功，ID: ${receipt.logs[0].args.proposalId.toString()}`);
  }
  async function proposeSetBorrowerRewardRatio() {
    const ratioRaw = document.getElementById("newBorrowerRewardRatio").value;
    const newRatio = BigInt(ratioRaw);

    const desc = document.getElementById("proposalDescBorrowerReward").value;
    if (!desc) return alert("請填寫提案描述");

    const encoded = bankV3Contract.interface.encodeFunctionData("setBorrowerRewardRatio", [newRatio]);
    const target = await bankV3Contract.getAddress();

    const tx = await bankGovernorContract.propose([target], [0], [encoded], desc);
    const receipt = await tx.wait();

    alert(`✅ Borrower 發幣提案成功，ID: ${receipt.logs[0].args.proposalId.toString()}`);
  }
  //提出調整每日發幣上限的提案
  async function proposeChangeDailyCap() {
    const capRaw = document.getElementById("newDailyCap").value;
    const newCap = BigInt(capRaw);  // ✅ 修正點：直接 BigInt，不 parseUnits
    const desc = document.getElementById("proposalDescCap").value;
    if (!desc) return alert("請填寫提案描述");

    const encoded = bankV3Contract.interface.encodeFunctionData("setDailyCap", [newCap]);
    const target = await bankV3Contract.getAddress();
    const descriptionHash = getDescriptionHash(desc);

    // ✅ 正確使用 batch 版本的 opHash
    const opHash = await bankTimelockContract.hashOperationBatch(
      [target],
      [0],
      [encoded],
      ethers.ZeroHash,
      descriptionHash
    );

    console.log("🟨 [Propose]");
    console.log("📌 target:", target);
    console.log("🧮 encoded:", encoded);
    console.log("🧾 descriptionHash:", descriptionHash);
    console.log("🔑 operationHash (opHash):", opHash);

    const tx = await bankGovernorContract.propose([target], [0], [encoded], desc);
    const receipt = await tx.wait();
    alert("✅ 提案成功，ID: " + receipt.logs[0].args.proposalId.toString());
  }
  //提出調整協議收入比例的提案
  async function proposeChangeReserveFactor() {
    const newFactor = parseInt(document.getElementById("newReserveFactor").value);
    const desc = document.getElementById("proposalDescReserveFactor").value;
    if (!desc) return alert("請填寫提案描述");

    const encoded = bankV3Contract.interface.encodeFunctionData("setReserveFactor", [newFactor]);
    const target = await bankV3Contract.getAddress();  // ✅
    const tx = await bankGovernorContract.propose([target], [0], [encoded], desc);
    const receipt = await tx.wait();
    alert("✅ 已成功提案，ID: " + receipt.logs[0].args.proposalId.toString());
  }
  // 提案轉移治理權限（更新 governance）
  window.proposeChangeGovernance = async function () {
    const newGov = document.getElementById("newGovernanceAddr").value;
    const desc = document.getElementById("proposalDescGovernance").value;
    if (!ethers.isAddress(newGov) || !desc) return alert("請輸入正確地址與描述");

    const encoded = bankV3Contract.interface.encodeFunctionData("setGovernance", [newGov]);
    const target = await bankV3Contract.getAddress();  // ✅
    const tx = await bankGovernorContract.propose([target], [0], [encoded], desc);
    const receipt = await tx.wait();
    alert("✅ 提案成功，ID: " + receipt.logs[0].args.proposalId.toString());
  };
  //提出調整「提案有效票數門檻（%）」的提案(g)
  window.proposeChangeQuorumPercent = async function () {
    const percent = parseInt(document.getElementById("newQuorumPercent").value);
    const desc = document.getElementById("proposalDescQuorum").value;
    if (isNaN(percent) || percent <= 0 || percent > 100 || !desc) {
      return alert("請輸入 1~100 的百分比與描述");
    }

    const encoded = bankGovernorContract.interface.encodeFunctionData("setQuorumPercent", [percent]);
    const target = await bankGovernorContract.getAddress();  // ✅
    const tx = await bankGovernorContract.propose([target], [0], [encoded], desc);
    const receipt = await tx.wait();
    alert("✅ 提案成功，ID: " + receipt.logs[0].args.proposalId.toString());
  };
  //提出調整「提案門檻」的提案(g)
  async function proposeChangeProposalThreshold() {
    const input = document.getElementById("newProposalThreshold").value;
    const threshold = ethers.parseUnits(input, 18);
    const desc = document.getElementById("proposalDescThreshold").value;
    if (!desc) return alert("請填寫提案描述");

    const encoded = bankGovernorContract.interface.encodeFunctionData("setProposalThreshold", [threshold]);
    const target = await bankGovernorContract.getAddress();  // ✅
    const tx = await bankGovernorContract.propose([target], [0], [encoded], desc);
    const receipt = await tx.wait();
    alert("✅ 已成功提交提案，ID: " + receipt.logs[0].args.proposalId.toString());
  }
  async function proposeInjectToLP() {
    const amountRaw = document.getElementById("injectLPAmount").value;
    const desc = document.getElementById("proposalDescInjectLP").value;

    if (!desc) return alert("請填寫提案描述");

    const amount = BigInt(amountRaw); // 選單已是 wei 單位，不需 parseUnits
    const encoded = bankV3Contract.interface.encodeFunctionData("injectProtocolEarningsToLP", [amount]);
    const target = await bankV3Contract.getAddress();

    const tx = await bankGovernorContract.propose([target], [0], [encoded], desc);
    const receipt = await tx.wait();

    alert("✅ 提案成功，ID: " + receipt.logs[0].args.proposalId.toString());
  }

// === LP 操作 ===
  async function lpSupply() {
    await safeAction("提供流動性", async () => {
      const amount = document.getElementById("lpSupplyAmount").value;
      if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
        throw new Error("請輸入正確的 mDAI 數量");

      console.log("📥 提供流動性金額:", amount, "mDAI");

      const rewardRatio = await bankV3Contract.rewardRatio();                    // 每 1 mDAI 可拿幾顆 BKT
      const cap = await bankV3Contract.dailyCap();                              // 每日上限 BKT 數量
      const joinedAt = await bankV3Contract.lpJoinedAt(account);                // 加入時間戳
      const bktVotes = await bankTokenContract.getVotes(account);               // 擁有投票權（需 delegate）
      const bktBalance = await bankTokenContract.balanceOf(account);            // BKT 餘額

      console.log("rewardRatio:", rewardRatio.toString());
      console.log("dailyCap:", ethers.formatUnits(cap, 18));
      console.log("lpJoinedAt:", joinedAt.toString());
      console.log("目前票數（votes）:", ethers.formatUnits(bktVotes, 18));
      console.log("目前 BKT 餘額:", ethers.formatUnits(bktBalance, 18));

      const parsedAmount = ethers.parseUnits(amount, 18);
      await miniDaiContract.approve(bankV3Address, parsedAmount);
      const tx = await bankV3Contract.supply(parsedAmount);
      await tx.wait();
    });
  }
  async function lpRedeem() {
    await safeAction("贖回流動性", async () => {
      const amount = document.getElementById("lpRedeemAmount").value;
      if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
        throw new Error("請輸入正確的 aMDAI 數量");

      const parsedAmount = ethers.parseUnits(amount, 18);
      const tx = await bankV3Contract.redeem(parsedAmount);
      await tx.wait();
    });
  }
 
// 綁定到 window
window.proposeChangeProposalThreshold = proposeChangeProposalThreshold;
window.delegateVotes = delegateVotes;
window.proposeChangeInterest = proposeChangeInterest;
window.castVote = castVote;
window.queueProposal = queueProposal;
window.executeProposal = executeProposal;
window.updateVotingInfo        = updateVotingInfo;
window.proposeChangeInterest   = proposeChangeInterest;
window.proposeChangeRewardRatio= proposeChangeRewardRatio;
window.proposeChangeDailyCap   = proposeChangeDailyCap;
window.connectWallet = connectWallet;
window.depositETH = depositETH;
window.borrow = borrow;
window.repay = repay;
window.withdrawCollateral = withdrawCollateral;
window.liquidateUser = liquidateUser;
window.simulatePriceChange = simulatePriceChange;
window.checkProposalVotes = checkProposalVotes;
