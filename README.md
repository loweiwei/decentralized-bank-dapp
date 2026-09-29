# Decentralized Bank DApp

這是一個以 Hardhat 開發的去中心化銀行專題，實作抵押借貸、流動性供應、清算、獎勵發放與 DAO 治理流程。使用者可以抵押 ETH 借出 MiniDAI，LP 可以供應 MiniDAI 取得 aMDAI share，系統會依照供應或抵押狀態發放 BankToken 作為獎勵與治理代幣。

本專題包含 Solidity 智能合約、部署腳本、測試案例，以及一個使用 ethers.js 與 MetaMask 互動的前端頁面。

## 核心功能

- ETH 抵押借款：使用者抵押 ETH，依 LTV 借出 MiniDAI。
- LP 流動性供應：LP 存入 MiniDAI，取得 aMDAI 作為池中份額憑證。
- 還款與利息：借款人可償還本金與利息，利息分配給 LP 與協議儲備。
- 清算機制：當抵押健康因子低於門檻時，清算人可代還債務並取得 ETH 抵押品獎勵。
- 獎勵系統：LP 與借款人可累積並領取 BKT 獎勵，並受每日發放上限限制。
- DAO 治理：使用 BankToken 投票，透過 Governor 與 Timelock 調整協議參數。
- 前端操作：提供抵押、借款、還款、清算、領獎勵與治理提案操作介面。

## 技術架構

- Solidity `0.8.20`
- Hardhat
- OpenZeppelin Contracts
- ethers.js v6
- MetaMask
- HTML / JavaScript 靜態前端

## 合約介紹

### `BankV3.sol`

專案的核心銀行合約，負責主要業務邏輯。

- 管理 ETH 抵押品與 MiniDAI 債務。
- 計算 LTV、健康因子與可借款額度。
- 處理借款、還款、清算與 LP 供應/贖回。
- 管理協議儲備金與獎勵發放。
- 提供 DAO 可調整參數，例如利率、每日獎勵上限、reserve factor、獎勵速率等。

### `MiniDAI.sol`

專案內使用的 ERC20 穩定幣。

- 代幣名稱：MiniDAI
- 代幣符號：mDAI
- 由 owner 或授權 minter 鑄造。
- 在借貸流程中作為借出與償還資產。

### `aMDAI.sol`

LP 供應流動性後取得的 ERC20 share token。

- 代幣名稱：aMDAI Token
- 代幣符號：aMDAI
- 只有 Bank 合約可以 mint/burn。
- 用來代表 LP 在流動性池中的份額。

### `PriceOracle.sol`

測試用 ETH 價格 Oracle。

- 提供 ETH/USD 價格。
- 可手動調整價格，用於模擬抵押品價格下跌與清算情境。
- 目前適合本機測試與專題展示，不是正式鏈上 Oracle。

### `BankToken.sol`

治理與獎勵用 ERC20Votes 代幣。

- 代幣名稱：BankToken
- 代幣符號：BKT
- 部署時一次性鑄造固定供應量。
- 可用於 DAO 投票與協議獎勵發放。

### `BankGovernor.sol`

DAO 治理合約。

- 使用 OpenZeppelin Governor。
- 支援提案、投票、排程與執行。
- 可透過治理調整 Bank 參數與治理門檻。

### `BankTimelock.sol`

治理執行延遲合約。

- 使用 OpenZeppelin TimelockController。
- 通過的提案需先進入 Timelock，等待延遲後才能執行。
- 作為 BankV3 的 governance 地址。

## 主要流程

1. LP 將 MiniDAI 存入 BankV3，取得 aMDAI。
2. 借款人抵押 ETH。
3. BankV3 根據 Oracle 價格與 LTV 計算可借額度。
4. 借款人借出 MiniDAI。
5. 若 ETH 價格下跌或利息累積導致健康因子過低，清算人可執行清算。
6. 使用者依角色累積 BKT 獎勵。
7. BKT 持有人可委託投票權並參與 DAO 治理。

## 專案目錄

```text
contracts/    Solidity 智能合約
scripts/      部署與本機測試腳本
test/         Hardhat 測試案例
frontend/     靜態前端與部署輸出的 ABI/address
```

## 安裝與執行

安裝依賴：

```shell
npm install
```

編譯合約：

```shell
npm run compile
```

啟動本機節點：

```shell
npm run node
```

部署到本機節點：

```shell
npm run deploy:localhost
```

部署後會將合約地址與 ABI 輸出到 `frontend/`，供前端讀取。

## 前端使用方式

1. 先啟動 Hardhat 本機節點。
2. 執行部署腳本產生最新 ABI 與合約地址。
3. 用瀏覽器開啟 `frontend/index.html`。
4. 連接 MetaMask，切換到本機 Hardhat 網路。
5. 使用頁面操作 LP 供應、抵押、借款、還款、清算、領取獎勵與 DAO 治理功能。

## 測試

執行完整測試：

```shell
npm test
```

目前完整 Hardhat 測試套件可通過，涵蓋借款、還款、LP 供應、清算、獎勵與部分治理相關流程。

## 專題重點

- 完整實作借貸協議常見流程：供應、借款、還款、清算。
- 加入 LP share token 與獎勵發放機制。
- 使用 Governor + Timelock 實作 DAO 參數治理。
- 提供前端介面展示鏈上操作流程。
- 使用測試 Oracle 模擬價格變動與清算情境。
