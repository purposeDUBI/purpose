// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../ERC20.sol";

contract DummyERC20 is ERC20 {
    constructor(
        string memory name,
        string memory symbol,
        address initialHolder,
        uint256 initialSupply,
        address optIn
    )
        public
        ERC20(
            name,
            symbol,
            optIn,
            address(0),
            address(0),
            address(0),
            address(0)
        )
    {
        _mintInitialSupply(initialHolder, initialSupply);
    }

    function burn(address account, uint256 amount) public {
        _burn(account, amount, "", false);
    }

    function transferInternal(
        address from,
        address to,
        uint256 value
    ) public {
        _move(from, to, value);
    }

    function approveInternal(
        address owner,
        address spender,
        uint256 value
    ) public {
        _approve(owner, spender, value);
    }

    function burnFuel(address from, TokenFuel memory fuel) external override {}

    function _getHasherContracts()
        internal
        override
        returns (address[] memory)
    {
        return new address[](0);
    }

    function _burnBoostedSendFuel(
        address from,
        BoosterFuel memory fuel,
        UnpackedData memory unpacked
    ) internal override returns (FuelBurn memory) {}

    function _burnBoostedBurnFuel(
        address from,
        BoosterFuel memory fuel,
        UnpackedData memory unpacked
    ) internal override returns (FuelBurn memory) {}
}
