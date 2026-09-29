// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";

contract BankGovernor is
    Governor,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorTimelockControl
{
    uint256 public proposalThresholdBKT;
    uint256 public quorumPercent; // 4 表示 4%

    constructor(
        ERC20Votes _token,
        TimelockController _timelock,
        uint256 _initialProposalThreshold,
        uint256 _initialQuorumPercent
    )
        Governor("BankGovernor")
        GovernorVotes(_token)
        GovernorTimelockControl(_timelock)
    {
        proposalThresholdBKT = _initialProposalThreshold;
        quorumPercent = _initialQuorumPercent;
    }

    // 可由 DAO 執行（Timelock）
    function setProposalThreshold(uint256 newThreshold) external onlyGovernance {
        proposalThresholdBKT = newThreshold;
    }
    function setQuorumPercent(uint256 newPercent) external onlyGovernance {
        require(newPercent <= 100, "Too high");
        quorumPercent = newPercent;
    }

    function proposalThreshold() public view override returns (uint256) {
        return proposalThresholdBKT;
    }

    /*function quorum(uint256 blockNumber) public view override returns (uint256) {
        return token.getPastTotalSupply(blockNumber) * quorumPercent / 100;
    }*/
    function quorum(uint256 blockNumber) public view override returns (uint256) {
        return token.getPastTotalSupply(blockNumber) * quorumPercent / 1000000;
    }

    function votingDelay() public pure override returns (uint256) {
        return 1; // 1 區塊延遲
    }

    function votingPeriod() public pure override returns (uint256) {
        return 4; // 
    }
    ////////
    function viewExecutor() public view returns (address) {
        return _executor();
    }

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function _execute(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._execute(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

}
