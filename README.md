# Decentralized Bank DApp

這是一個使用 Hardhat、Solidity、OpenZeppelin Governance 與 ethers.js 開發的去中心化銀行專題。專案實作抵押借貸、LP 流動性供應、還款利息分配、清算、BKT 獎勵發放，以及 DAO 治理參數調整。

使用者可以抵押 ETH 借出 MiniDAI，LP 可以供應 MiniDAI 取得 aMDAI 作為流動性份額，清算人可以在借款人健康因子過低時協助清算，BKT 持有人可以參與 DAO 投票調整協議參數。

## Project Highlights

- 完整實作 DeFi lending 常見流程：供應、抵押、借款、還款、清算。
- 使用 aMDAI 表示 LP 在資金池中的份額。
- 使用 BKT 作為獎勵代幣與 DAO 治理代幣。
- 使用 Governor + Timelock 實作鏈上治理流程。
- 使用測試 Oracle 模擬 ETH 價格變動與清算情境。
- 提供 HTML / JavaScript 前端與 MetaMask 互動。
- 完整 Hardhat 測試可通過，涵蓋主要合約流程。

## Tech Stack

| Layer | Technology |
| --- | --- |
| Smart Contract | Solidity `0.8.20` |
| Development | Hardhat |
| Contract Library | OpenZeppelin Contracts |
| Governance | OpenZeppelin Governor, TimelockController, ERC20Votes |
| Frontend | HTML, JavaScript, ethers.js v6 |
| Wallet | MetaMask |
| Test | Hardhat Network, Mocha, Chai |

## System Architecture

```text
User / LP / Liquidator / DAO Voter
        |
        v
frontend/index.html + frontend/app.js
        |
        v
ethers.js + MetaMask
        |
        v
BankV3 ---------------- PriceOracle
  |                         |
  |                         v
  |                   ETH price feed
  |
  |---- MiniDAI       借款、還款、LP 供應資產
  |---- aMDAI         LP share token
  |---- BankToken     BKT 獎勵與治理票權
  |
  v
BankGovernor -> BankTimelock -> BankV3 governance functions
```

系統的核心是 `BankV3`，它負責借貸、抵押、清算、LP share 與 reward accounting。`MiniDAI` 是協議內的穩定幣，`aMDAI` 是 LP 份額憑證，`BankToken` 是治理與獎勵用代幣。DAO 透過 `BankGovernor` 建立提案，再由 `BankTimelock` 延遲執行對 `BankV3` 的參數調整。

## Execution Pipeline

### 1. Deploy Pipeline

```text
npm run node
        |
        v
npm run deploy:localhost
        |
        v
Deploy PriceOracle
Deploy MiniDAI
Deploy BankToken
Deploy aMDAI
Deploy BankV3
Set MiniDAI minter = BankV3
Set aMDAI bank = BankV3
Deploy BankTimelock
Deploy BankGovernor
Transfer BankV3 governance to Timelock
Export ABI and addresses to frontend/
```

部署腳本位於 `scripts/deploy.js`。部署完成後，前端會使用 `frontend/contract-address.json` 與各合約 ABI JSON 連接合約。

### 2. Frontend Interaction Pipeline

```text
Open frontend/index.html
        |
        v
Connect MetaMask
        |
        v
Load contract-address.json and ABI files
        |
        v
Create ethers.Contract instances
        |
        v
Call BankV3, MiniDAI, PriceOracle, BankToken, Governor, Timelock
```

前端沒有使用 React 或後端伺服器，是純 HTML / JavaScript 靜態頁面。所有鏈上互動都透過 ethers.js v6 與 MetaMask signer 發送交易。

### 3. Lending Pipeline

```text
LP supplies MiniDAI
        |
        v
BankV3 receives MiniDAI and mints aMDAI
        |
        v
Borrower deposits ETH collateral
        |
        v
BankV3 reads ETH price from PriceOracle
        |
        v
Borrower borrows MiniDAI under LTV limit
        |
        v
Debt accrues interest over time
        |
        v
Borrower repays principal and interest
        |
        v
Interest is split between LP pool and protocol reserve
```

### 4. Liquidation Pipeline

```text
ETH price drops or debt grows
        |
        v
Health factor falls below liquidation threshold
        |
        v
Liquidator repays part of borrower's MiniDAI debt
        |
        v
BankV3 reduces borrower debt
        |
        v
Liquidator receives ETH collateral with bonus
        |
        v
Protocol receives reserve factor share
```

清算機制透過 `getHealthFactor()` 判斷帳戶風險。當健康因子低於 `LIQUIDATION_THRESHOLD` 時，清算人可以呼叫 `liquidate()`。

### 5. Governance Pipeline

```text
BKT holder delegates voting power
        |
        v
Create proposal through BankGovernor
        |
        v
Voting delay
        |
        v
Voting period
        |
        v
Proposal succeeds if votes and quorum pass
        |
        v
Queue proposal into BankTimelock
        |
        v
Wait minDelay
        |
        v
Execute proposal through Timelock
        |
        v
Update BankV3 or Governor parameter
```

目前治理可調整項目包含利率、每日 BKT 發放上限、reserve factor、LP reward ratio、borrower reward ratio、提案門檻與 quorum 相關參數。

## Smart Contracts

| Contract | Role |
| --- | --- |
| `BankV3.sol` | 借貸核心合約，管理抵押、借款、還款、清算、LP pool、reward 與 DAO 可調參數。 |
| `MiniDAI.sol` | 協議內穩定幣，作為借款、還款與 LP 供應資產。 |
| `aMDAI.sol` | LP share token，代表使用者在流動性池中的份額。 |
| `PriceOracle.sol` | 測試用 ETH/USD 價格 Oracle，可模擬價格變動。 |
| `BankToken.sol` | BKT，ERC20Votes 治理代幣，同時作為協議 reward token。 |
| `BankGovernor.sol` | DAO 治理合約，負責提案、投票、queue 與 execute。 |
| `BankTimelock.sol` | Timelock 執行延遲合約，作為 BankV3 governance executor。 |

## Contract Details

### `BankV3.sol`

`BankV3` 是整個專案的核心，負責協調所有資產、債務與治理參數。

主要狀態：

| State | Meaning |
| --- | --- |
| `liquidityPool` | Bank 中可借出的 MiniDAI 流動性。 |
| `totalDebtCached` | 系統目前紀錄的總債務。 |
| `totalCollateral` | 所有使用者抵押的 ETH 總量。 |
| `protocolTokenReserve` | 協議累積的 MiniDAI 收益。 |
| `collateral[user]` | 使用者抵押的 ETH 數量。 |
| `debts[user]` | 使用者借款本金與上次計息時間。 |
| `lpRewards[user]` | LP 的 reward accounting。 |
| `borrowerRewards[user]` | 抵押者的 reward accounting。 |

主要參數：

| Parameter | Meaning |
| --- | --- |
| `interestRate` | 借款利率，使用萬分比表示。 |
| `LTV` | 最大借款比例，目前預設 80%。 |
| `LIQUIDATION_THRESHOLD` | 清算門檻，健康因子低於此值可被清算。 |
| `BONUS_PERCENT` | 清算人取得抵押品時的額外獎勵比例。 |
| `reserveFactor` | 協議從利息或清算中抽取的比例。 |
| `dailyCap` | 每日最多發放的 BKT 數量。 |
| `lpRewardRatio` | LP reward 發放速率。 |
| `borrowerRewardRatio` | Borrower reward 發放速率。 |

核心函式：

| Function | Description |
| --- | --- |
| `supply(amount)` | LP 存入 MiniDAI，取得 aMDAI。 |
| `redeem(amount)` | LP 燒毀 aMDAI，取回可贖回的 MiniDAI。 |
| `depositCollateral()` | 使用者抵押 ETH。 |
| `withdrawCollateral(amount)` | 使用者提取 ETH，需維持足夠抵押率。 |
| `borrow(amount)` | 使用者依 LTV 借出 MiniDAI。 |
| `repay(amount)` | 使用者償還 MiniDAI，拆分本金、LP 收益與協議收益。 |
| `liquidate(user, repayAmount)` | 清算低健康因子帳戶。 |
| `claimReward(isLP)` | LP 或 borrower 領取 BKT reward。 |
| `getHealthFactor(user)` | 查詢使用者健康因子。 |
| `estimateMaxLiquidate(user)` | 預估最大可清算金額。 |

DAO 可呼叫函式：

| Function | Description |
| --- | --- |
| `setInterestRate(newRate)` | 調整借款利率。 |
| `setDailyCap(newCap)` | 調整每日 BKT 發放上限。 |
| `setReserveFactor(newFactor)` | 調整協議收益比例。 |
| `setLPRewardRatio(newRatio)` | 調整 LP reward 發放速率。 |
| `setBorrowerRewardRatio(newRatio)` | 調整 borrower reward 發放速率。 |
| `injectProtocolEarningsToLP(amount)` | 將協議 MiniDAI 收益注入 LP pool。 |
| `changeStatus(status)` | 調整協議狀態。 |

### `MiniDAI.sol`

`MiniDAI` 是協議內使用的 ERC20 穩定幣，借款人借出的資產與還款資產都是 MiniDAI。

| Feature | Description |
| --- | --- |
| ERC20 | 使用 OpenZeppelin ERC20。 |
| Burnable | 支援 ERC20Burnable。 |
| Ownable | owner 可以設定 minter。 |
| Minter | BankV3 被設定為 minter 後，可以配合協議流程鑄造。 |

### `aMDAI.sol`

`aMDAI` 是 LP share token，代表 LP 對 `liquidityPool` 的份額。

| Feature | Description |
| --- | --- |
| Mint | 只有 BankV3 可以在 LP supply 時 mint。 |
| Burn | 只有 BankV3 可以在 LP redeem 時 burn。 |
| Share | 用於計算 LP 可贖回的 MiniDAI 比例。 |

### `PriceOracle.sol`

`PriceOracle` 是測試用 Oracle，提供 ETH/USD 價格。

| Function | Description |
| --- | --- |
| `setPrice(price)` | 手動設定 ETH 價格，單位為 8 decimals。 |
| `getLatestETHPrice()` | 回傳目前 ETH 價格。 |

此 Oracle 主要用於本機測試與專題展示，讓前端或測試可以模擬 ETH 價格下跌並觸發清算。

### `BankToken.sol`

`BankToken` 是 BKT，使用 ERC20Votes 實作治理票權。

| Feature | Description |
| --- | --- |
| ERC20Votes | 支援投票權快照與 delegate。 |
| Fixed Supply | 部署時一次性鑄造固定供應量。 |
| Reward Token | BankV3 持有部分 BKT，用於 LP 與 borrower reward。 |
| Governance Token | BKT 持有人可以委託票權並參與 DAO 投票。 |

### `BankGovernor.sol`

`BankGovernor` 使用 OpenZeppelin Governor 組合治理模組。

| Feature | Description |
| --- | --- |
| Proposal | BKT 投票權達門檻者可以建立提案。 |
| Voting | 支援 For、Against、Abstain。 |
| Quorum | 依 BKT past total supply 計算有效門檻。 |
| Timelock | 成功提案需 queue 到 Timelock 後才能 execute。 |

### `BankTimelock.sol`

`BankTimelock` 繼承 OpenZeppelin TimelockController。部署後 `BankV3.governance` 會轉移到 Timelock，因此 DAO 通過的提案會經由 Timelock 執行。

## Core User Flows

### LP Supply and Redeem

1. LP 取得 MiniDAI。
2. LP approve `BankV3` 使用 MiniDAI。
3. LP 呼叫 `supply(amount)`。
4. BankV3 將 MiniDAI 加入 `liquidityPool`。
5. BankV3 mint aMDAI 給 LP。
6. LP 可呼叫 `redeem(amount)` 燒毀 aMDAI 並取回 MiniDAI。

### Borrow and Repay

1. 借款人呼叫 `depositCollateral()` 抵押 ETH。
2. BankV3 透過 PriceOracle 查詢 ETH 價格。
3. BankV3 根據 LTV 計算可借額度。
4. 借款人呼叫 `borrow(amount)` 借出 MiniDAI。
5. 債務依時間累積利息。
6. 借款人 approve MiniDAI 並呼叫 `repay(amount)`。
7. 還款會拆分為本金減少、LP pool 收益與 protocol reserve。

### Liquidation

1. ETH 價格下跌或債務利息增加。
2. `getHealthFactor(user)` 低於 `LIQUIDATION_THRESHOLD`。
3. 清算人 approve MiniDAI 並呼叫 `liquidate(user, repayAmount)`。
4. BankV3 收取清算人的 MiniDAI。
5. BankV3 減少借款人的債務。
6. 清算人取得部分 ETH 抵押品與清算 bonus。
7. 協議取得 reserve factor 收益。

### Reward Claim

1. LP 供應 MiniDAI 或 borrower 抵押 ETH。
2. BankV3 根據時間、資產價值與 reward ratio 累積 BKT。
3. 每日發放量受到 `dailyCap` 限制。
4. 使用者呼叫 `claimReward(true)` 領 LP reward。
5. 使用者呼叫 `claimReward(false)` 領 borrower reward。

### DAO Governance

1. BKT 持有人呼叫 `delegate()` 將投票權委託給自己或其他地址。
2. 達到 proposal threshold 的帳戶建立提案。
3. 提案進入 voting delay。
4. 投票期間 BKT voters 投票。
5. 通過 quorum 與多數支持後，提案進入 Succeeded。
6. 使用者將提案 queue 到 BankTimelock。
7. 等待 minDelay 後 execute。
8. Timelock 呼叫 BankV3 或 BankGovernor 的治理函式。

## Project Structure

```text
contracts/    Solidity smart contracts
scripts/      Deployment and local interaction scripts
test/         Hardhat test suite
frontend/     Static DApp, ABI files, and deployed addresses
```

## Install and Run

Install dependencies:

```shell
npm install
```

Compile contracts:

```shell
npm run compile
```

Run tests:

```shell
npm test
```

Start a local Hardhat node:

```shell
npm run node
```

Deploy to local Hardhat network:

```shell
npm run deploy:localhost
```

After deployment, ABI files and contract addresses are exported to `frontend/`.

## Frontend Usage

1. Start a local Hardhat node with `npm run node`.
2. Deploy contracts with `npm run deploy:localhost`.
3. Open `frontend/index.html` in the browser.
4. Connect MetaMask to the local Hardhat network.
5. Use the UI to supply, borrow, repay, liquidate, claim rewards, and create DAO proposals.

## Test Coverage

The Hardhat test suite covers the main protocol flows:

| Test Area | Covered Behavior |
| --- | --- |
| BankV3 end-to-end | Collateral deposit, borrowing, interest, liquidation, repayment, withdraw restriction. |
| LP supply | Multiple LP supply/redeem behavior and aMDAI share tracking. |
| Repayment | Principal, LP yield, and protocol reserve split. |
| Liquidation | Health factor based liquidation and collateral transfer. |
| Reward | LP and borrower BKT reward accrual and claim. |
| Reward edge cases | Withdraw, partial liquidation, full claim, daily cap behavior. |

Current test result:

```text
21 passing
```

## Notes

- `PriceOracle` is a testing oracle for local demonstration and is not intended for production deployment.
- Interest timing is simplified for testing and demonstration purposes.
- Frontend ABI and address files are generated by `scripts/deploy.js` for local usage.
