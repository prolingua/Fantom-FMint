const {
  BN,
  constants,
  expectEvent,
  time
} = require('@openzeppelin/test-helpers');

const { ethers } = require('hardhat');
const { expect } = require('chai');

const { weiToEther, etherToWei, amount18 } = require('./utils/index');

const FantomLiquidationManager = artifacts.require(
  'MockFantomLiquidationManager'
);
const FantomMintTokenRegistry = artifacts.require('FantomMintTokenRegistry');
const FantomDeFiTokenStorage = artifacts.require('FantomDeFiTokenStorage');
const FantomMint = artifacts.require('FantomMint');
const FantomMintAddressProvider = artifacts.require(
  'FantomMintAddressProvider'
);
const FantomMintRewardDistribution = artifacts.require(
  'FantomMintRewardDistribution'
);
const FantomFUSD = artifacts.require('FantomFUSD');
const MockToken = artifacts.require('MockToken');
const MockPriceOracleProxy = artifacts.require('MockPriceOracleProxy');

const SFCToFMint = artifacts.require('SFCToFMint');
const UnitTestSFC = artifacts.require('UnitTestSFC');
const UnitTestSFCLib = artifacts.require('UnitTestSFCLib');
const SFCI = artifacts.require('SFCUnitTestI');
const NodeDriverAuth = artifacts.require('NodeDriverAuth');
const NodeDriver = artifacts.require('NodeDriver');
const NetworkInitializer = artifacts.require('UnitTestNetworkInitializer');
const StubEvmWriter = artifacts.require('StubEvmWriter');
const ConstantsManager = artifacts.require('ConstantsManager');
const StakeTokenizer = artifacts.require('StakeTokenizer');

var amountToMint;

async function sealEpoch(sfc, duration, _validatorsMetrics = undefined) {
  let validatorsMetrics = _validatorsMetrics;
  const validatorIDs = (await sfc.lastValidatorID()).toNumber();

  if (validatorsMetrics === undefined) {
    validatorsMetrics = {};
    for (let i = 0; i < validatorIDs; i++) {
      validatorsMetrics[i] = {
        offlineTime: new BN('0'),
        offlineBlocks: new BN('0'),
        uptime: duration,
        originatedTxsFee: amount18('0')
      };
    }
  }
  // unpack validator metrics
  const allValidators = [];
  const offlineTimes = [];
  const offlineBlocks = [];
  const uptimes = [];
  const originatedTxsFees = [];
  for (let i = 0; i < validatorIDs; i++) {
    allValidators.push(i + 1);
    offlineTimes.push(validatorsMetrics[i].offlineTime);
    offlineBlocks.push(validatorsMetrics[i].offlineBlocks);
    uptimes.push(validatorsMetrics[i].uptime);
    originatedTxsFees.push(validatorsMetrics[i].originatedTxsFee);
  }

  await sfc.advanceTime(duration);
  await sfc.sealEpoch(
    offlineTimes,
    offlineBlocks,
    uptimes,
    originatedTxsFees,
    0
  );
  await sfc.sealEpochValidators(allValidators);
}

const pubkey =
  '0x00a2941866e485442aa6b17d67d77f8a6c4580bb556894cc1618473eff1e18203d8cce50b563cf4c75e408886079b8f067069442ed52e2ac9e556baa3f8fcc525f';

let testValidator1ID;
let testValidator3ID;
let lockedStake;

contract('FantomLiquidationManager', function([
  firstValidator,
  borrower,
  secondBorrower,
  liquidator,
  secondLiquidator
]) {
  before(async function() {
    provider = ethers.provider;

    this.sfc = await SFCI.at((await UnitTestSFC.new()).address);
    const nodeIRaw = await NodeDriver.new();
    const evmWriter = await StubEvmWriter.new();
    this.nodeI = await NodeDriverAuth.new();
    this.sfcLib = await UnitTestSFCLib.new();

    this.mocksFTM = await MockToken.new({ from: firstValidator });
    await this.mocksFTM.initialize('sFTM', 'sFTM', 18);

    this.stakeTokenizer = await StakeTokenizer.new();
    await this.stakeTokenizer.initialize(
      this.sfc.address,
      this.mocksFTM.address
    );

    this.sfcToFMint = await SFCToFMint.new(
      this.sfcLib.address,
      this.sfc.address,
      this.stakeTokenizer.address
    );

    const initializer = await NetworkInitializer.new();

    await initializer.initializeAll(
      0,
      0,
      this.sfc.address,
      this.sfcLib.address,
      this.nodeI.address,
      nodeIRaw.address,
      evmWriter.address,
      firstValidator
    );
    this.consts = await ConstantsManager.at(
      await this.sfc.constsAddress.call()
    );
    await this.sfc.rebaseTime();
    await this.sfc.enableNonNodeCalls();
    await this.sfc.updateStakeTokenizerAddress(this.stakeTokenizer.address);

    await this.consts.updateBaseRewardPerSecond(amount18('1'));

    await this.sfc.createValidator(pubkey, {
      from: borrower,
      value: amount18('1000')
    });
    await this.sfc.createValidator(pubkey, {
      from: secondBorrower,
      value: amount18('1000')
    });

    await sealEpoch(this.sfc, new BN(0).toString());

    testValidator1ID = await this.sfc.getValidatorID(borrower);
    testValidator2ID = await this.sfc.getValidatorID(secondBorrower);

    await this.sfc.lockStake(
      testValidator1ID,
      60 * 60 * 24 * 364,
      amount18('1000'),
      { from: borrower }
    );

    await this.sfc.lockStake(
      testValidator2ID,
      60 * 60 * 24 * 364,
      amount18('1000'),
      { from: secondBorrower }
    );
    //10000000000000000000000
    //999000000000000000000

    await sealEpoch(this.sfc, new BN(0).toString());

    await this.sfc.getEpochValidatorIDs(5555);

    /** all the necessary setup  */
    this.fantomMintAddressProvider = await FantomMintAddressProvider.new({
      from: firstValidator
    });
    await this.fantomMintAddressProvider.initialize(firstValidator);

    this.fantomLiquidationManager = await FantomLiquidationManager.new({
      from: firstValidator
    });
    await this.fantomLiquidationManager.initialize(
      firstValidator,
      this.fantomMintAddressProvider.address,
      this.sfcToFMint.address
    );

    this.fantomMint = await FantomMint.new({ from: firstValidator });
    await this.fantomMint.initialize(
      firstValidator,
      this.fantomMintAddressProvider.address
    );

    this.fantomMintTokenRegistry = await FantomMintTokenRegistry.new();
    await this.fantomMintTokenRegistry.initialize(firstValidator);

    this.collateralPool = await FantomDeFiTokenStorage.new({
      from: firstValidator
    });
    await this.collateralPool.initialize(
      this.fantomMintAddressProvider.address,
      true
    );

    this.debtPool = await FantomDeFiTokenStorage.new({ from: firstValidator });
    await this.debtPool.initialize(
      this.fantomMintAddressProvider.address,
      true
    );

    this.fantomFUSD = await FantomFUSD.new({ from: firstValidator });

    await this.fantomFUSD.initialize(firstValidator);

    this.fantomMintRewardDistribution = await FantomMintRewardDistribution.new({
      from: firstValidator
    });
    await this.fantomMintRewardDistribution.initialize(
      firstValidator,
      this.fantomMintAddressProvider.address
    );

    this.mockToken = await MockToken.new({ from: firstValidator });
    await this.mockToken.initialize('sFTM', 'sFTM', 18);

    this.mockPriceOracleProxy = await MockPriceOracleProxy.new({
      from: firstValidator
    });

    await this.fantomMintAddressProvider.setFantomMint(
      this.fantomMint.address,
      { from: firstValidator }
    );
    await this.fantomMintAddressProvider.setCollateralPool(
      this.collateralPool.address,
      { from: firstValidator }
    );
    await this.fantomMintAddressProvider.setDebtPool(this.debtPool.address, {
      from: firstValidator
    });
    await this.fantomMintAddressProvider.setTokenRegistry(
      this.fantomMintTokenRegistry.address,
      { from: firstValidator }
    );
    await this.fantomMintAddressProvider.setRewardDistribution(
      this.fantomMintRewardDistribution.address,
      { from: firstValidator }
    );
    await this.fantomMintAddressProvider.setPriceOracleProxy(
      this.mockPriceOracleProxy.address,
      { from: firstValidator }
    );
    await this.fantomMintAddressProvider.setFantomLiquidationManager(
      this.fantomLiquidationManager.address,
      { from: firstValidator }
    );

    // set the initial value; 1 wFTM = 1 USD; 1 xFTM = 1 USD; 1 fUSD = 1 USD
    await this.mockPriceOracleProxy.setPrice(
      this.mockToken.address,
      etherToWei(1)
    );
    await this.mockPriceOracleProxy.setPrice(
      this.fantomFUSD.address,
      etherToWei(1)
    );

    await this.fantomMintTokenRegistry.addToken(
      this.mockToken.address,
      '',
      this.mockPriceOracleProxy.address,
      18,
      true,
      true,
      false,
      true
    );
    await this.fantomMintTokenRegistry.addToken(
      this.fantomFUSD.address,
      '',
      this.mockPriceOracleProxy.address,
      18,
      true,
      false,
      true,
      false
    );

    await this.fantomFUSD.addMinter(this.fantomMint.address, {
      from: firstValidator
    });

    await this.fantomLiquidationManager.updateFantomMintContractAddress(
      this.fantomMint.address,
      { from: firstValidator }
    );

    // mint liquidator enough fUSD to bid for liquidated collateral
    await this.fantomFUSD.mint(liquidator, etherToWei(10000), {
      from: firstValidator
    });

    // mint liquidator enough fUSD to bid for liquidated collateral
    await this.fantomFUSD.mint(secondLiquidator, etherToWei(10000), {
      from: firstValidator
    });
  });

  describe('Deposit Collateral', function() {
    it('should get the correct wFTM price ($1)', async function() {
      const price = await this.mockPriceOracleProxy.getPrice(
        this.mockToken.address
      );

      expect(weiToEther(price).toString()).to.be.equal('1');
    });

    it('should allow the borrower to deposit 999 wFTM', async function() {
      await this.mockToken.mint(borrower, etherToWei(999));

      await this.mockToken.approve(this.fantomMint.address, etherToWei(999), {
        from: borrower
      });

      // make sure the wFTM (test token) can be registered
      const canDeposit = await this.fantomMintTokenRegistry.canDeposit(
        this.mockToken.address
      );
      //console.log('canDeposit: ', canDeposit);
      expect(canDeposit).to.be.equal(true);

      // borrower deposits all his/her 999 wFTM
      await this.fantomMint.mustDeposit(
        this.mockToken.address,
        etherToWei(999),
        { from: borrower }
      );

      const balance1 = await this.mockToken.balanceOf(borrower);

      expect(balance1).to.be.bignumber.equal('0');
    });

    it('should show 999 wFTM in Collateral Pool (for borrower)', async function() {
      // check the collateral balance of the borrower in the collateral pool
      const balance2 = await this.collateralPool.balanceOf(
        borrower,
        this.mockToken.address
      );
      expect(weiToEther(balance2)).to.be.equal('999');

      // now FantomMint contract should get 999 wFTM
      const balance3 = await this.mockToken.balanceOf(this.fantomMint.address);
      expect(weiToEther(balance3)).to.be.equal('999');
    });
  });
  describe('Mint fUSD', function() {
    it('should give a maxToMint (fUSD) value around 333', async function() {
      const maxToMint = await this.fantomMint.maxToMint(
        borrower,
        this.fantomFUSD.address,
        30000
      );
      amountToMint = maxToMint;

      expect(maxToMint).to.be.bignumber.greaterThan('0');
      expect(weiToEther(maxToMint) * 1).to.be.lessThanOrEqual(3333);
    });

    it('should mint maximium (3333) amount of fUSD', async function() {
      // mint maximum amount possible of fUSD for borrower
      await this.fantomMint.mustMintMax(this.fantomFUSD.address, 30000, {
        from: borrower
      });

      const fUSDBalance = await this.fantomFUSD.balanceOf(borrower);
      totalSupply = weiToEther(await this.fantomFUSD.totalSupply());

      expect(weiToEther(fUSDBalance) * 1).to.be.lessThanOrEqual(3333);
    });
  });

  describe('Liquidation phase [Price goes down, liquidator gets the collateral]', function() {
    it('should get the new updated wFTM price ($1 -> $0.5)', async function() {
      // assume: the value of wFTM has changed to 0.5 USD !!
      await this.mockPriceOracleProxy.setPrice(
        this.mockToken.address,
        etherToWei(0.5)
      );

      const price = await this.mockPriceOracleProxy.getPrice(
        this.mockToken.address
      );

      expect(weiToEther(price).toString()).to.be.equal('0.5');
    });

    it('should find collateral not eligible anymore', async function() {
      // make sure the collateral isn't eligible any more
      const isEligible = await this.fantomLiquidationManager.collateralIsEligible(
        borrower,
        this.mockToken.address
      );

      expect(isEligible).to.be.equal(false);

      let balance = await this.mockToken.balanceOf(liquidator);
    });

    it('should have locked stake [1000]', async function() {
      lockedStake = await this.sfc.getLockedStake(borrower, testValidator1ID);
      expect(weiToEther(lockedStake) * 1).to.be.equal(1000);
    });

    it('should mint sFTM', async function() {
      await this.stakeTokenizer.mintSFTM(testValidator1ID, { from: borrower });
      const balanceRemaining = await this.stakeTokenizer.outstandingSFTM(
        borrower,
        testValidator1ID
      );

      expect(weiToEther(balanceRemaining) * 1).to.be.equal(1000);
    });

    it('should start liquidation and emit Repaid and Seized', async function() {
      await this.fantomFUSD.approve(
        this.fantomLiquidationManager.address,
        etherToWei(5000),
        { from: liquidator }
      );

      await this.mocksFTM.approve(
        this.stakeTokenizer.address,
        etherToWei(1000),
        { from: borrower }
      );

      var result = await this.fantomLiquidationManager.liquidate(borrower, {
        from: liquidator
      });
      expectEvent(result, 'Repaid', {
        target: borrower,
        liquidator: liquidator,
        token: this.fantomFUSD.address,
        amount: amountToMint
      });
      expectEvent(result, 'Seized', {
        target: borrower,
        liquidator: liquidator,
        token: this.mockToken.address,
        amount: etherToWei('999')
      });
    });

    it('should have locked stake [1]', async function() {
      lockedStake = await this.sfc.getLockedStake(borrower, testValidator1ID);
      expect(weiToEther(lockedStake) * 1).to.be.equal(1);
    });

    it('the liquidator should have (10000 - 333) 9667 fUSD remaining', async function() {
      let currentBalance = await this.fantomFUSD.balanceOf(liquidator);

      expect(weiToEther(currentBalance) * 1).to.lessThan(10000);
    });

    it('the liquidator should get the complete wFTM collateral (from the liquidation)', async function() {
      let balance = await this.mockToken.balanceOf(liquidator);
      expect(weiToEther(balance) * 1).to.equal(999);
    });

    it('the collateral pool should have 0 balance remaining', async function() {
      let balance = await this.collateralPool.balanceOf(
        borrower,
        this.mockToken.address
      );
      expect(weiToEther(balance) * 1).to.equal(0);
    });
  });

  describe('Liquidation phase [With no sFTM minted]', function() {
    it('should find collateral not eligible anymore', async function() {
      await this.mockPriceOracleProxy.setPrice(
        this.mockToken.address,
        etherToWei(1)
      );

      await this.mockToken.mint(secondBorrower, etherToWei(999));

      await this.mockToken.approve(this.fantomMint.address, etherToWei(999), {
        from: secondBorrower
      });

      // make sure the wFTM (test token) can be registered
      const canDeposit = await this.fantomMintTokenRegistry.canDeposit(
        this.mockToken.address
      );
      //console.log('canDeposit: ', canDeposit);
      expect(canDeposit).to.be.equal(true);

      // secondBorrower deposits all his/her 999 wFTM
      await this.fantomMint.mustDeposit(
        this.mockToken.address,
        etherToWei(999),
        { from: secondBorrower }
      );

      await this.fantomMint.maxToMint(
        secondBorrower,
        this.fantomFUSD.address,
        30000
      );

      await this.fantomMint.mustMintMax(this.fantomFUSD.address, 30000, {
        from: secondBorrower
      });

      await this.mockPriceOracleProxy.setPrice(
        this.mockToken.address,
        etherToWei(0.5)
      );

      // make sure the collateral isn't eligible any more
      const isEligible = await this.fantomLiquidationManager.collateralIsEligible(
        secondBorrower,
        this.mockToken.address
      );

      expect(isEligible).to.be.equal(false);

      lockedStake = await this.sfc.getLockedStake(
        secondBorrower,
        testValidator2ID
      );
      expect(weiToEther(lockedStake) * 1).to.be.equal(1000);
    });

    it('should start liquidation and emit Repaid and Seized', async function() {
      await this.fantomFUSD.approve(
        this.fantomLiquidationManager.address,
        etherToWei(5000),
        { from: secondLiquidator }
      );

      var result = await this.fantomLiquidationManager.liquidate(
        secondBorrower,
        {
          from: secondLiquidator
        }
      );
      expectEvent(result, 'Repaid', {
        target: secondBorrower,
        liquidator: secondLiquidator,
        token: this.fantomFUSD.address,
        amount: amountToMint
      });
      expectEvent(result, 'Seized', {
        target: secondBorrower,
        liquidator: secondLiquidator,
        token: this.mockToken.address,
        amount: etherToWei('999')
      });
    });

    it('the (second) liquidator should have (10000 - 333) 9667 fUSD remaining', async function() {
      let currentBalance = await this.fantomFUSD.balanceOf(secondLiquidator);

      expect(weiToEther(currentBalance) * 1).to.lessThan(10000);
    });

    it('the (second) liquidator should get the complete wFTM collateral (from the liquidation)', async function() {
      let balance = await this.mockToken.balanceOf(secondLiquidator);
      expect(weiToEther(balance) * 1).to.equal(999);
    });

    it('the collateral pool should have 0 balance remaining', async function() {
      let balance = await this.collateralPool.balanceOf(
        secondBorrower,
        this.mockToken.address
      );
      expect(weiToEther(balance) * 1).to.equal(0);
    });
  });
});
