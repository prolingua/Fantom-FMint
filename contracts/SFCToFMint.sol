pragma solidity ^0.5.0;

interface SFCLib {
    function unlockStake(
        uint256 toValidatorID,
        uint256 amount,
        address
    ) external returns (uint256);
}

interface SFC {
    function getValidatorID(address) external returns (uint256);
}

interface IStakeTokenizer {
    function outstandingSFTM(address, uint256) external returns (uint256);

    function redeemSFTM(uint256 validatorID, uint256 amount) external;
}

contract SFCToFMint {
    SFCLib internal sfcLib;
    SFC internal sfc;
    IStakeTokenizer internal stakeTokenizer;

    constructor(
        address _sfcLib,
        address _sfc,
        IStakeTokenizer _stakeTokenizer
    ) public {
        sfcLib = SFCLib(_sfcLib);
        sfc = SFC(_sfc);
        stakeTokenizer = _stakeTokenizer;
    }

    function removeStake(address _targetAddress, uint256 amount) external {
        uint256 validatorID = sfc.getValidatorID(_targetAddress);
        uint256 stakedsFTM = stakeTokenizer.outstandingSFTM(
            _targetAddress,
            validatorID
        );

        if (stakedsFTM >= amount) {
            stakeTokenizer.redeemSFTM(validatorID, amount);
        }

        sfcLib.unlockStake(validatorID, amount, _targetAddress);
    }
}
