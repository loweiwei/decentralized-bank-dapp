// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; // ✅ 補上這行

contract MiniDAI is ERC20, ERC20Burnable, Ownable {
    address public minter;

    constructor(address initialOwner) ERC20("MiniDAI", "mDAI") {
        transferOwnership(initialOwner);
    }

    function setMinter(address _minter) external onlyOwner {
        minter = _minter;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == minter || msg.sender == owner(), "Not authorized");
        _mint(to, amount);
    }

    function burnFromBank(address from, uint256 amount) external {
        require(msg.sender == minter || msg.sender == owner(), "Not authorized");
        require(balanceOf(from) >= amount, "Insufficient balance to burn");
        _burn(from, amount);
    }


}
