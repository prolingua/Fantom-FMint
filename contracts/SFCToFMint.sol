pragma solidity ^0.5.0;
import "hardhat/console.sol";


interface SFCLib {
    function unlockStake(
        uint256 toValidatorID,
        uint256 amount,
        address
    ) external returns (uint256);

    function isLockedUp(address delegator, uint256 toValidatorID) external view returns (bool);
}

interface SFC {
    function getValidatorID(address) external returns (uint256);
    function show_getLockupInfo_endTime(address _targetAddress, uint256 validatorID ) external returns (uint256);
    function isLockedUp(address delegator, uint256 toValidatorID) external view returns (bool);
    function unlockStake(uint256 toValidatorID, uint256 amount, address _targetAddress) external returns (uint256);
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
        console.log("-----");
        console.log("within removeStake");
        console.log("calling isLockedUp from sfcLib");
        bool lockedUp = sfcLib.isLockedUp(_targetAddress, validatorID);
        console.log("lockedUp from sfcLib: ", lockedUp);
        lockedUp = sfc.isLockedUp(_targetAddress, validatorID);
        console.log("lockedUp from sfc: ", lockedUp);
        
        sfc.unlockStake(validatorID, amount, _targetAddress);
        //sfcLib.unlockStake(validatorID, amount, _targetAddress);
    }
}
