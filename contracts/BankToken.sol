// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";

/**
 * @title BankToken (BKT)
 * @dev 治理用 ERC20Votes 代幣，總供應量固定、一次性鑄造。
 *      無任何 mint 權限、無 owner，保證去中心化。
 */
contract BankToken is ERC20Votes {
    /**
     * @param _initialSupply 一次性鑄造的初始總供應（通常為 1,000,000 顆）
     */
    constructor(uint256 _initialSupply)
        ERC20("BankToken", "BKT")
        ERC20Permit("BankToken")
    {
        _mint(msg.sender, _initialSupply); // ✅ 初始鑄造給部署者（由 deploy.js 負責分發）
    }
    // --- 以下為 ERC20Votes 的必要覆寫 ---

    function _afterTokenTransfer(address from, address to, uint256 amount)
        internal
        override(ERC20Votes)
    {
        super._afterTokenTransfer(from, to, amount);
    }

    function _mint(address to, uint256 amount)
        internal
        override(ERC20Votes)
    {
        super._mint(to, amount);
    }

    function _burn(address account, uint256 amount)
        internal
        override(ERC20Votes)
    {
        super._burn(account, amount);
    }


}
