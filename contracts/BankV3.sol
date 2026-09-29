// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MiniDAI.sol";
import "./PriceOracle.sol";
import "./aMDAI.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";


interface IBankToken {
    //function mint(address to, uint256 amount) external;
    function transfer(address to, uint256 amount) external returns (bool);

}
interface IaMDAI {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256); // ✅ 加這行
}
/*interface IFlashLoanReceiver {
    function executeOperation(uint256 amount, uint256 fee, bytes calldata data) external returns (bool);
}*/

contract BankV3 is ReentrancyGuard {
    // === 合約實例 ===
    MiniDAI public miniDai;
    PriceOracle public priceOracle;
    IBankToken public bankToken;
    IaMDAI public aMDAIToken;

    address public governance;

// === 狀態控制 ===
    
    Status public status;
    bool public governanceLocked = false;
// === 參數 ===
    // ===  DAO 可調參數（治理可控） ===
    uint256 public interestRate = 500;           // 5% 年利率（萬分比）
    uint256 public maxTotalDebt = 1_000_000 * 1e18; // 總債務上限
    //!!!!
    uint256 public reserveFactor = 1000;         // 協議利息抽成比例（10%）
    uint256 public rewardRatio = 318287037037 ; // 每天總共發 0.01 BKT / USD;           // 每存入 1 mDAI 獲得 50 顆 BKT（單位：1e18）
    uint256 public lpRewardRatio = 3e11;         // 每秒每 USD 給 LP 的發幣速率
    uint256 public borrowerRewardRatio = 1.5e11; // 給 Borrower 的發幣速率
    uint256 public dailyCap = 275e18;           // 每日最多發放 BKT 數量上限
    uint256 public lastRewardUpdateTime;     // 上一次 reward 結算時間戳（用來判斷是否跨日）
    uint256 public LTV = 8000;                   // 抵押品 LTV 值（80%）
    //!!!!
    uint256 public LIQUIDATION_THRESHOLD = 9000; // 健康因子低於 0.9 會觸發清算
    //!!!!
    uint256 public BONUS_PERCENT = 3000;         // 清算人可獲得 30% 額外 ETH 獎勵
    uint256 public MAX_ELAPSED_TIME = 30 days;   // 最長計息時間（避免利息爆炸）
    // ===  常數參數（不可由 DAO 更動） ===
    uint256 public constant DECIMALS = 1e4;          // 比例精度（萬分比）
    uint256 public constant MAX_LIQUIDATION_PERCENT = 5000; // 最多可清算 50% 債務
    uint256 constant PRICE_DIV = 1e26;               // ETH 價格轉換因子（1e8 × 1e18）
    uint256 public constant SECONDS_PER_YEAR = 60;   // 測試用途：60 秒 = 1 年（方便觀察利息變化）
    // ===  平台狀態參數 ===
    uint256 public liquidityPool;        // mDAI 流動性池（LP 提供）
    uint256 public totalDebtCached;      // 全部用戶債務（含利息）
    uint256 public totalCollateral;      // 全部用戶抵押的 ETH 總量
    // ===  協議收益（利息 + 清算回收） ===
    uint256 public protocolTokenReserve; // MiniDAI 收益儲備
    uint256 public protocolETHReserve;   // ETH 收益儲備（清算回收）
    // ===  發幣邏輯相關參數 ===
    uint256 public distributedToday;         // 當日已發放的獎勳總量（BKT）
    uint256 public lastRewardDay;        // 最後一次發獎勳的日數（timestamp / 1 days）
    // ===  角色發幣比例（常數） ===
    uint256 constant SUPPLIER_BASE = 7000;  // 存款者佔 70% 發幣獎勳
    uint256 constant BORROWER_BASE = 3000;  // 借款者佔 30% 發幣獎勳
// === STRUCT ===
    struct DebtInfo {
        uint256 principal;
        uint256 lastAccrued;
    }
    struct RewardInfo {
        uint256 lastUpdate;      // 上次更新時間
        uint256 unclaimedBKT;    // 累積的可領獎勳
        uint256 supplyAmount;    // 存入資產量（mDAI or ETH）
    }
// === mapping (debts)(collateral)(lpJoinedAt)(collateralJoinedAt) ===
    mapping(address => uint256) public collateral; // === 抵押資訊（ETH） ===
    mapping(address => uint256) public lpJoinedAt;            // LP 供應時間
    mapping(address => uint256) public collateralJoinedAt;    // 抵押 ETH 的時間   
    mapping(address => RewardInfo) public lpRewards;        // for LP
    mapping(address => RewardInfo) public borrowerRewards;  // for borrower
    mapping(address => DebtInfo) public debts;
// === Events ===
    event Borrowed(address indexed user, uint256 amount);
    event RepaidDetailed(address indexed user, uint256 burned, uint256 toLP, uint256 toProtocol);
    event Liquidated(address indexed liquidator, address indexed user, uint256 seizedCollateral);
    event StatusChanged(Status newStatus);
    event Withdrawn(address indexed user, uint256 amount);
    event ReserveWithdrawn(address indexed recipient, uint256 amount);
    event RewardMinted(address indexed user, uint256 amount);
    event RewardRatioChanged(uint256 newRatio);
    event DailyCapChanged(uint256 newCap);
    event Supplied(address indexed user, uint256 miniDAIAmount, uint256 shares);
    event Redeemed(address indexed user, uint256 miniDAIAmount, uint256 shares);
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event ProtocolEarningsInjected(uint256 tokenAmount);
    event GovernanceTransferred(address oldGov, address newGov);
    event RewardClaimed(address indexed user, uint256 amount);

    
// === Modifiers ===
    modifier onlyGovernance() {
        require(
            msg.sender == governance ,
            "!gov"
        );
        _;
    }
    enum Status { STARTED, PAUSED, CLOSED }
    modifier onlyStarted() { require(status == Status.STARTED, "Not started"); _; }
// === Constructor ===
    constructor(address _miniDai, address _oracle, address _governance, address _bkt, address _aMDAI) {
        miniDai = MiniDAI(_miniDai);
        priceOracle = PriceOracle(_oracle);
        governance = _governance;
        bankToken = IBankToken(_bkt);
        aMDAIToken = IaMDAI(_aMDAI); // ✅ 使用新變數名
        status = Status.STARTED;
        lastRewardUpdateTime = block.timestamp;
    }

// === dao === 
    function setInterestRate(uint256 newRate) external onlyGovernance {
        require(newRate <= 2000, "Too high");
        interestRate = newRate;
    }
    function setRewardRatio(uint256 newRatio) external onlyGovernance {
        rewardRatio = newRatio;
        emit RewardRatioChanged(newRatio);
    }
    //
    function setLPRewardRatio(uint256 newRatio) external onlyGovernance {
        lpRewardRatio = newRatio;
    }
    function setBorrowerRewardRatio(uint256 newRatio) external onlyGovernance {
        borrowerRewardRatio = newRatio;
    }
    //
    function setDailyCap(uint256 newCap) external onlyGovernance {
        dailyCap = newCap;
        emit DailyCapChanged(newCap);
    }
    function setReserveFactor(uint256 newFactor) external onlyGovernance {
        require(newFactor <= 2000, "Too high");
        reserveFactor = newFactor;
    }
    function setMaxTotalDebt(uint256 newMax) external onlyGovernance {
        require(newMax >= 100_000 * 1e18, "Too low");
        maxTotalDebt = newMax;
    }
    //還沒用dap
    function setGovernance(address newGov) external onlyGovernance {
        require(!governanceLocked, "Governance is locked");
        governance = newGov;
    }
    //還沒用dap
    function lockGovernance() external onlyGovernance {
        governanceLocked = true;
    }
    //還沒用dap
    function changeStatus(Status _status) external onlyGovernance {
        status = _status;
        emit StatusChanged(_status);
    }    
    //治理者（DAO） 提領「協議的收益」
    //(more)把 protocolTokenReserve 定期「再注入流動性池」function injectProtocolEarningsToLP(uint256 amount)
    function withdrawETHReserve(address to, uint256 amount) external onlyGovernance nonReentrant {
        require(amount <= protocolETHReserve, "Insufficient reserve");
        protocolETHReserve -= amount;
        payable(to).transfer(amount);
        emit ReserveWithdrawn(to, amount);
    }
    function withdrawTokenReserve(address to, uint256 amount) external onlyGovernance nonReentrant {
        require(amount <= protocolTokenReserve, "Too much");
        protocolTokenReserve -= amount;
        miniDai.transfer(to, amount);
        emit ReserveWithdrawn(to, amount); // 建議補上

    }
    function injectProtocolEarningsToLP(uint256 amount) external onlyGovernance {
        require(amount <= protocolTokenReserve, "Too much");

        protocolTokenReserve -= amount;
        liquidityPool += amount;

        emit ProtocolEarningsInjected(amount); // amount 是 MiniDAI
    }   
    function transferGovernance(address newGov) external onlyGovernance {
        require(!governanceLocked, "Governance locked");
        emit GovernanceTransferred(governance, newGov);
        governance = newGov;
    }

// === 核心功能 ===
// === Internal ===
    function _updateDebt(address user) internal {
        uint256 old = debts[user].principal;
        (uint256 principal, uint256 interest) = getUserDebt(user);
        uint256 updated = principal + interest;
        debts[user].principal = updated;
        debts[user].lastAccrued = block.timestamp;

        if (updated >= old) {
            totalDebtCached += updated - old;
        } else if (old > updated) {
            uint256 diff = old - updated;
            if (totalDebtCached >= diff) totalDebtCached -= diff;
            else totalDebtCached = 0; // 最保守 fallback
        }
    }
    function _accruedDebt(address user) public view returns (uint256) {
        DebtInfo memory d = debts[user];
        uint256 elapsed = block.timestamp - d.lastAccrued;
        if (elapsed > MAX_ELAPSED_TIME) elapsed = MAX_ELAPSED_TIME;
        // ✅ 同樣改成ˇ365 -> 1 days 做快速測試用
        uint256 interest = (d.principal * interestRate * elapsed) / (1 days * DECIMALS);
        return d.principal + interest;
    }
    function _updateReward(address user, bool isLP) internal {
        RewardInfo storage info = isLP ? lpRewards[user] : borrowerRewards[user];
        uint256 current = block.timestamp;

        if (info.lastUpdate == 0) {
            info.lastUpdate = current;
            return;
        }

        uint256 timeElapsed = current - info.lastUpdate;
        if (timeElapsed == 0 || info.supplyAmount == 0) return;

        uint256 usdValue;
        if (isLP) {
            usdValue = info.supplyAmount;
        } else {
            uint256 price = priceOracle.getLatestETHPrice(); // 1 ETH = price * 1e8
            usdValue = info.supplyAmount * price / 1e8;
        }

        // ✅ 根據角色選擇對應 reward ratio
        uint256 ratio = isLP ? lpRewardRatio : borrowerRewardRatio;
        uint256 pending = usdValue * ratio * timeElapsed / 1e18;
        //uint256 pending = usdValue * rewardRatio * timeElapsed / 1e18;

        // ✅ 檢查是否跨天：如果有，就重設 daily counter
        if (current / 1 days > lastRewardUpdateTime / 1 days) {
            distributedToday = 0;
        }

        // ✅ 計算當天剩下能發的數量
        uint256 available = dailyCap > distributedToday ? (dailyCap - distributedToday) : 0;

        // ✅ 套用 cap 限制
        if (pending > available) {
            pending = available;
        }

        info.unclaimedBKT += pending;
        info.lastUpdate = current;
        distributedToday += pending;
        lastRewardUpdateTime = current;
    }
// === 一般動作 (normal user) ===
    function borrow(uint256 amount) external onlyStarted {
        _updateDebt(msg.sender);

        uint256 maxBorrow = getCollateralValueUSD(msg.sender) * LTV / DECIMALS;
        require(debts[msg.sender].principal + amount <= maxBorrow, "Exceeds LTV");
        require(amount <= liquidityPool, "Not enough liquidity");

        debts[msg.sender].principal += amount;
        debts[msg.sender].lastAccrued = block.timestamp;
        totalDebtCached += amount;
        liquidityPool -= amount;

        miniDai.transfer(msg.sender, amount);
    }
    function depositCollateral() external payable onlyStarted {
        require(msg.value > 0, "Zero collateral");

        // ⏱️ 如果是首次抵押，記錄加入時間
        if (collateral[msg.sender] == 0) {
            collateralJoinedAt[msg.sender] = block.timestamp;
        }
        _updateReward(msg.sender, false); // false = borrower
        collateral[msg.sender] += msg.value;
        totalCollateral += msg.value;

        // ✅ 使用時間加乘獎勳邏輯，isLP = false
        borrowerRewards[msg.sender].supplyAmount += msg.value;


        emit CollateralDeposited(msg.sender, msg.value);
    }
    function withdrawCollateral(uint256 amount) external onlyStarted nonReentrant {
        require(amount > 0 && amount <= collateral[msg.sender], "Invalid");

        _updateDebt(msg.sender);

        // 預先扣掉 supplyAmount，避免獎勳計算膨脹
        if (borrowerRewards[msg.sender].supplyAmount >= amount) {
            borrowerRewards[msg.sender].supplyAmount -= amount;
        } else {
            borrowerRewards[msg.sender].supplyAmount = 0;
        }

        _updateReward(msg.sender, false);

        uint256 newCol = collateral[msg.sender] - amount;
        uint256 debt = _accruedDebt(msg.sender);

        // ✅ 僅當有債務時才做抵押率限制
        if (debt > 0) {
            uint256 ethPrice = priceOracle.getLatestETHPrice(); // 1e8
            uint256 newColUSD = (newCol * ethPrice) / 1e8;
            uint256 requiredColUSD = (debt * DECIMALS) / LTV;

            require(newColUSD >= requiredColUSD, "Undercollateralized");
        }

        collateral[msg.sender] = newCol;
        totalCollateral -= amount;

        if (newCol == 0) {
            borrowerRewards[msg.sender] = RewardInfo(0, 0, 0);
        }

        payable(msg.sender).transfer(amount);
    }
    function repay(uint256 amount) external onlyStarted {
        require(amount > 0, "Zero repay");

        // 查詢當前債務
        (uint256 principal, uint256 interest) = getUserDebt(msg.sender);
        uint256 userTotalDebt = principal + interest;
        require(userTotalDebt > 0, "No debt");

        uint256 actualAmount = amount > userTotalDebt ? userTotalDebt : amount;

        // ✅ 先收全額，再退多的（為保證順序與邏輯）
        miniDai.transferFrom(msg.sender, address(this), amount);

        // ✅ 如果多給了，就退還差額
        if (amount > actualAmount) {
            uint256 refund = amount - actualAmount;
            miniDai.transfer(msg.sender, refund);
        }

        // === 拆分邏輯 ===

        // 計算要燒掉多少本金
        uint256 toBurn = actualAmount >= userTotalDebt
            ? principal
            : actualAmount > interest
                ? actualAmount - interest
                : 0;

        // 給協議的收入（依利息比例）
        uint256 toProtocol = actualAmount > interest 
            ? interest * reserveFactor / DECIMALS 
            : actualAmount * reserveFactor / DECIMALS;

        // 剩下給 LP
        uint256 toLP = actualAmount - toBurn - toProtocol;

        // ✅ 如果要燒本金
        if (toBurn > 0) {
            // ✅ 不再 burn
            debts[msg.sender].principal -= toBurn;
            totalDebtCached -= toBurn;
            // ⬆ 本金記帳減少
            // 資金面：toBurn 的 mDAI 已經在 transferFrom 中進 Pool
            // 所以只需更新帳本，不動資金
        }


        // 更新利息時間點（principal 已調整）
        _updateDebt(msg.sender);

        // 分配利息收益
        liquidityPool += toLP + toBurn;
        protocolTokenReserve += toProtocol;

        emit RepaidDetailed(msg.sender, toBurn, toLP, toProtocol);
    }
// === 清算人 ===
    function liquidate(address user, uint256 repayAmount) external onlyStarted nonReentrant {
        require(repayAmount > 0, "Zero repay");
        (uint256 rawPrincipal, uint256 interest) = getUserDebt(user);
        _updateDebt(user);

        uint256 hf = getHealthFactor(user);
        require(hf < LIQUIDATION_THRESHOLD, "Health factor ok");

        uint256 principalBefore = debts[user].principal;

        uint256 maxRepay = principalBefore * MAX_LIQUIDATION_PERCENT / 10000;

        if (repayAmount > maxRepay) {
            repayAmount = maxRepay;
        }

        uint256 ethPrice = priceOracle.getLatestETHPrice()* 1e10;

        uint256 userCollateral = collateral[user];

        uint256 maxRewardUSD = userCollateral * ethPrice / 1e18;

        uint256 maxEffectiveRepay = maxRewardUSD * DECIMALS / (BONUS_PERCENT + DECIMALS);

        uint256 maxRepayWithProtocol = maxEffectiveRepay * (1e4 + reserveFactor) / 1e4;

        if (repayAmount > maxRepayWithProtocol) {
            repayAmount = maxRepayWithProtocol;
        }

        require(miniDai.transferFrom(msg.sender, address(this), repayAmount), "Transfer failed");

        uint256 protocolShare = repayAmount * reserveFactor / 1e4;
        uint256 effectiveRepay = repayAmount - protocolShare;

        uint256 toLP;
        uint256 burned;

        if (effectiveRepay <= interest) {
            toLP = effectiveRepay;
            burned = 0;
        } else {
            toLP = interest;
            burned = effectiveRepay - interest;
        }

        uint256 rewardUSD = effectiveRepay * (BONUS_PERCENT + DECIMALS) / DECIMALS;

        uint256 seized = rewardUSD * 1e18 / ethPrice;

        if (seized > userCollateral) {
            seized = userCollateral;
        }

        // Update borrower state
        collateral[user] -= seized;
        totalCollateral -= seized;

        if (rawPrincipal >= burned) {
            debts[user].principal = rawPrincipal - burned;
        } else {
            debts[user].principal = 0;
        }
        debts[user].lastAccrued = block.timestamp;

        if (totalDebtCached >= burned) {
            totalDebtCached -= burned;
        } else {
            totalDebtCached = 0;
        }

        liquidityPool  += effectiveRepay ;
        protocolTokenReserve += protocolShare;

        payable(msg.sender).transfer(seized);

        emit Liquidated(msg.sender, user, seized);
        emit RepaidDetailed(user, burned, toLP, protocolShare);
    }
    function estimateMaxLiquidate(address user) external view returns (uint256) {
        uint256 principal = debts[user].principal;
        if (principal == 0) return 0;

        uint256 maxRepay = principal * MAX_LIQUIDATION_PERCENT / 1e4;

        uint256 ethPrice = priceOracle.getLatestETHPrice() * 1e10; // → 1e18 USD/ETH
        uint256 colETH = collateral[user];

        // 抵押物的價值（USD, 1e18）
        uint256 maxRewardUSD = (colETH * ethPrice) / 1e18;

        // 根據 BONUS 計算出有效 mDAI 上限
        uint256 maxEffectiveRepay = maxRewardUSD * DECIMALS / (BONUS_PERCENT + DECIMALS);

        // 還要考慮 protocol 抽成：這是清算人最多可還的總額
        uint256 maxRepayWithProtocol = maxEffectiveRepay * (1e4 + reserveFactor) / 1e4;

        // 取兩者較小的值，作為實際最大可還款
        return maxRepayWithProtocol < maxRepay ? maxRepayWithProtocol : maxRepay;
    }

// === LP 功能 ===
    //使用者把資金存進流動池 → 可借給他人
    function supply(uint256 amount) external onlyStarted nonReentrant {
        require(amount > 0, "Zero supply");
        _updateReward(msg.sender, true); // true = LP
        miniDai.transferFrom(msg.sender, address(this), amount);
        aMDAIToken.mint(msg.sender, amount);
        liquidityPool += amount;

        if (lpJoinedAt[msg.sender] == 0) {
            lpJoinedAt[msg.sender] = block.timestamp;
        }
        lpRewards[msg.sender].supplyAmount += amount;

        emit Supplied(msg.sender, amount, amount);
    }
    //使用者把資金(mdai)->()
    function redeem(uint256 amount) external onlyStarted nonReentrant {
        require(amount > 0, "Zero redeem");

        _updateReward(msg.sender, true); // LP

        uint256 totalSupply = aMDAIToken.totalSupply();
        require(totalSupply > 0, "No aMDAIToken");

        uint256 redeemAmount = liquidityPool * amount / totalSupply;
        require(redeemAmount <= liquidityPool, "Insufficient pool liquidity");

        // ✅ 修正 reward 基底減法，依照 aMDAI 顆數
        if (lpRewards[msg.sender].supplyAmount >= amount) {
            lpRewards[msg.sender].supplyAmount -= amount;
        } else {
            lpRewards[msg.sender].supplyAmount = 0;
        }

        aMDAIToken.burn(msg.sender, amount);
        liquidityPool -= redeemAmount;
        miniDai.transfer(msg.sender, redeemAmount);

        emit Redeemed(msg.sender, redeemAmount, amount);
    }
    function getExchangeRate() public view returns (uint256) {
        uint256 totalShares = aMDAIToken.totalSupply();

        if (totalShares == 0) {
            return 1e18; // 初始兌換比 = 1.0
        }

        return liquidityPool * 1e18 / totalShares;
    }
// === 領BKT ===
    function claimReward(bool isLP) external {
        _updateReward(msg.sender, isLP);
        RewardInfo storage info = isLP ? lpRewards[msg.sender] : borrowerRewards[msg.sender];

        uint256 amount = info.unclaimedBKT;
        require(amount > 0, "Nothing to claim");

        info.unclaimedBKT = 0;
        bankToken.transfer(msg.sender, amount);
        emit RewardClaimed(msg.sender, amount);
    }    
// === Views ===
    function getBorrowerRewardInfo(address user) external view returns (RewardInfo memory) {
        return borrowerRewards[user];
    }
    function getCollateralValueUSD(address user) public view returns (uint256) {
        return collateral[user] * priceOracle.getLatestETHPrice() / 1e8;
    }
    function getHealthFactor(address user) public view returns (uint256) {
        uint256 debt = _accruedDebt(user);
        if (debt == 0) return type(uint256).max;
        if (collateral[user] < 1e10) return 0;
        return getCollateralValueUSD(user) * DECIMALS / debt;
    }
    function getUtilizationRate() public view returns (uint256) {
        uint256 totalAssets = totalDebtCached + liquidityPool;
        if (totalAssets == 0) return 0;
        return totalDebtCached * DECIMALS / totalAssets;
    }
    function getMaxWithdrawableETH(address user) external view returns (uint256) {
        uint256 ethPrice = priceOracle.getLatestETHPrice(); // 1e8
        uint256 debt = _accruedDebt(user); // 1e18 wei = mDAI

        uint256 userColETH = collateral[user];
        if (debt == 0) {
            return userColETH;
        }

        // 不要除以 1e18，保持 1e18 精度的 USD
        uint256 minRequiredColUSD = (debt * DECIMALS) / LTV;
        uint256 currentColUSD = (userColETH * ethPrice) / 1e8;

        if (currentColUSD <= minRequiredColUSD) return 0;

        uint256 withdrawableUSD = currentColUSD - minRequiredColUSD;

        // ✅ 正確單位：ETH（wei）
        return (withdrawableUSD * 1e8) / ethPrice;
    }
    function getUserDebt(address user) public view returns (uint256 principal, uint256 interest) {
        DebtInfo memory d = debts[user];
        uint256 elapsed = block.timestamp - d.lastAccrued;
        if (elapsed > MAX_ELAPSED_TIME) elapsed = MAX_ELAPSED_TIME;
        //改成365 -> 1 天(利率變動)
        uint256 accrued = d.principal * interestRate * elapsed / (1 days * DECIMALS);
        return (d.principal, accrued);
    }
    function getUserAccountData(address user) external view returns (
        uint256 collateralUSD,
        uint256 debt,
        uint256 available
    ) {
        uint256 c = getCollateralValueUSD(user);
        uint256 d = _accruedDebt(user);
        uint256 limit = c * LTV / DECIMALS;
        uint256 avail = limit > d ? limit - d : 0;
        return (c, d, avail);
    }
    function getProtocolETHReserve() external view returns (uint256) {
        return protocolETHReserve;
    }
    function getProtocolTokenReserve() external view returns (uint256) {
        return protocolTokenReserve;
    }
    function getCurrentETHPrice() external view returns (uint256) {
        return priceOracle.getLatestETHPrice();
    }
    function getInterestRate() external view returns (uint256) {
        return interestRate;
    }
    function getStatus() external view returns (Status) {
        return status;
    }
    /// @notice 回傳清算觸發價格（USD×1e8）。當 ETH 價格低於此值即可清算。
    function getLiquidationPrice(address user) external view returns (uint256) {
        uint256 principalWei = debts[user].principal;   // DAI-wei
        uint256 collateralWei = collateral[user];          // ETH-wei
        if (principalWei == 0 || collateralWei == 0) {
            return 0;
        }

        // 1. 將債務（DAI-wei）換算成 USD×1e8
        //    principalWei / 1e18 → DAI (≈USD)，再乘 1e8
        uint256 debtUSD8 = principalWei * 1e8 / 1e18;

        // 2. 套用清算閾值（LIQUIDATION_THRESHOLD / DECIMALS）
        uint256 targetUSD8 = debtUSD8 * LIQUIDATION_THRESHOLD / DECIMALS;

        // 3. 反推 ETH 價格： price (USD×1e8) = targetUSD8 * 1e18 / collateralWei
        return targetUSD8 * 1e18 / collateralWei;
    }
    function getTotalSupplied() external view returns (uint256) {
        return liquidityPool;
    }
    function getLPInfo(address user) external view returns (
        uint256 userAMDAI,
        uint256 totalAMDAI,
        uint256 sharePercent,      // 萬分比（1e4 = 10000 = 100%）
        uint256 redeemableMDAI
    ) {
        uint256 userShare = aMDAIToken.balanceOf(user);
        uint256 totalShares = aMDAIToken.totalSupply();
        uint256 redeemable = totalShares == 0 ? 0 : liquidityPool * userShare / totalShares;
        uint256 percent = totalShares == 0 ? 0 : userShare * 1e4 / totalShares;

        return (userShare, totalShares, percent, redeemable);
    }
    /// @notice 回傳尚未納入本金的即時計算利息
    function previewInterest(address user) public view returns (uint256) {
        (, uint256 interest) = getUserDebt(user); // ✅ 利用現有 view 計算
        return interest;
    }
    /// @notice 傳回總債務（本金 + 利息）
    function getTotalDebt(address user) external view returns (uint256) {
        (uint256 principal, uint256 interest) = getUserDebt(user);
        return principal + interest;
    }
    function debugDebtDetail(address user) external view returns (
        uint256 principal,
        uint256 interestRate_,
        uint256 elapsed,
        uint256 interest,
        uint256 totalDebt
    ) {
        DebtInfo memory d = debts[user];
        uint256 nowTime = block.timestamp;
        uint256 elapsedTime = nowTime - d.lastAccrued;
        if (elapsedTime > MAX_ELAPSED_TIME) elapsedTime = MAX_ELAPSED_TIME;

        uint256 interestAccrued = d.principal * interestRate * elapsedTime / (1 days * DECIMALS);
        return (
            d.principal,
            interestRate,
            elapsedTime,
            interestAccrued,
            d.principal + interestAccrued
        );
    }
    function debugElapsed(address user) external view returns (
        uint256 principal,
        uint256 elapsed,
        uint256 nowTime,
        uint256 lastAccrued
    ) {
        DebtInfo memory d = debts[user];
        return (d.principal, block.timestamp - d.lastAccrued, block.timestamp, d.lastAccrued);
    }
    function getUnclaimedReward(address user, bool isLP) external view returns (uint256) {
        RewardInfo storage info = isLP ? lpRewards[user] : borrowerRewards[user];

        if (info.lastUpdate == 0 || info.supplyAmount == 0) {
            return info.unclaimedBKT;
        }

        uint256 timeElapsed = block.timestamp - info.lastUpdate;
        if (timeElapsed == 0) {
            return info.unclaimedBKT;
        }

        uint256 usdValue;
        if (isLP) {
            usdValue = info.supplyAmount; // mDAI = USD × 1e18
        } else {
            uint256 price = priceOracle.getLatestETHPrice(); // 1 ETH = price USD × 1e8
            usdValue = info.supplyAmount * price / 1e8;
        }

        // ✅ 根據角色選擇對應 reward ratio
        uint256 ratio = isLP ? lpRewardRatio : borrowerRewardRatio;
        uint256 pending = usdValue * ratio * timeElapsed / 1e18;
        return info.unclaimedBKT + pending;
    }
    function getRewardPreviewCapped(address user, bool isLP) external view returns (uint256) {
        RewardInfo storage info = isLP ? lpRewards[user] : borrowerRewards[user];

        if (info.lastUpdate == 0 || info.supplyAmount == 0) {
            return info.unclaimedBKT;
        }

        uint256 timeElapsed = block.timestamp - info.lastUpdate;
        if (timeElapsed == 0) {
            return info.unclaimedBKT;
        }

        uint256 usdValue;
        if (isLP) {
            usdValue = info.supplyAmount;
        } else {
            uint256 price = priceOracle.getLatestETHPrice(); // ETH × 1e8
            usdValue = info.supplyAmount * price / 1e8;
        }

        //uint256 pending = usdValue * rewardRatio * timeElapsed / 1e18;

            // ✅ 根據角色選擇對應 reward ratio
        uint256 ratio = isLP ? lpRewardRatio : borrowerRewardRatio;
        uint256 pending = usdValue * ratio * timeElapsed / 1e18;
        uint256 distributed = (block.timestamp / 1 days > lastRewardUpdateTime / 1 days)
            ? 0
            : distributedToday;

        uint256 available = dailyCap > distributed ? (dailyCap - distributed) : 0;
        if (pending > available) {
            pending = available;
        }

        return info.unclaimedBKT + pending;
    }
    function getPendingReward(address user, bool isLP) public view returns (uint256) {
        RewardInfo storage info = isLP ? lpRewards[user] : borrowerRewards[user];

        // 沒有初始化過，就沒有 pending reward
        if (info.lastUpdate == 0 || info.supplyAmount == 0) {
            return info.unclaimedBKT;
        }

        uint256 current = block.timestamp;
        uint256 timeElapsed = current - info.lastUpdate;
        if (timeElapsed == 0) {
            return info.unclaimedBKT;
        }

        uint256 usdValue;
        if (isLP) {
            usdValue = info.supplyAmount; // mDAI = USD × 1e18
        } else {
            uint256 price = priceOracle.getLatestETHPrice(); // 單位：1e8
            usdValue = info.supplyAmount * price / 1e8;
        }

        //uint256 pending = usdValue * rewardRatio * timeElapsed / 1e18;
        // ✅ 根據角色選擇對應 reward ratio
        uint256 ratio = isLP ? lpRewardRatio : borrowerRewardRatio;
        uint256 pending = usdValue * ratio * timeElapsed / 1e18;
        // 預估 dailyCap 還剩多少（不影響 distributedToday）
        uint256 available = dailyCap > distributedToday ? (dailyCap - distributedToday) : 0;
        if (pending > available) {
            pending = available;
        }

        return info.unclaimedBKT + pending;
    }
/// @notice 禁止直接轉帳
    receive() external payable {
        require(msg.sender == governance, "Only DAO can send ETH");
    }
}
