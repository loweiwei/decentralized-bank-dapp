// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title 可調整 ETH 價格的 Oracle，用於測試清算機制
contract PriceOracle {
    uint256 private  price = 1000 * 1e8; 

    /// @notice 設定新的 ETH 價格（單位為 8 decimals）
    /// @param _price 例如輸入 1600 * 1e8 代表 1600 美元
    function setPrice(uint256 _price) external {
        price = _price;
    }

    /// @notice 查詢當前 ETH 價格（8 decimals）
    function getLatestETHPrice() external view returns (uint256) {
        return price;
    }
}
