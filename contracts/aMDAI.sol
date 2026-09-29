// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title aMDAI - 代表 ETH 存款的利息累積代幣
contract aMDAI is ERC20, Ownable {
    address public bank;

    constructor() ERC20("aMDAI Token", "aMDAI") {}

    /// @notice 設定 Bank 合約地址，只能設定一次
    function setBank(address _bank) external onlyOwner {
        require(bank == address(0), "Bank already set");
        require(_bank != address(0), "Invalid bank address");
        bank = _bank;
    }

    /// @notice 只有 Bank 可以鑄造 aMDAI
    function mint(address to, uint256 amount) external {
        require(msg.sender == bank, "Only bank can mint");
        _mint(to, amount);
    }

    /// @notice 只有 Bank 可以銷毀 aMDAI
    function burn(address from, uint256 amount) external {
        require(msg.sender == bank, "Only bank can burn");
        _burn(from, amount);
    }
}
