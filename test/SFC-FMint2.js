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
  const SFC = artifacts.require('contracts/sfc/SFC.sol:SFC');
  const SFCLib = artifacts.require('contracts/sfc/SFCLib.sol:SFCLib');
  const SFCI = artifacts.require('SFCI');
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

  const SFC_ADDRESS = '0xF553900D56bb18a65612704fccB3DC299FD07e15';
  const NodeDriver_ADDRESS = '0xd2fADfDb6a8d8bCFeef97C8d50ac5DE6DAbcD58b';
  const StubEvmWriter_ADDRESS = '0x1E6d571e82f4c6f7a8662F6Fa6bCFB2642335052';
  const NodeDriverAuth_ADDRESS = '0x8d7c5DB4ea040179c7d76e4E2BBEcEc286635b68';
  const SFCLib_ADDRESS = '0x8c5aB50a431Cf537e3AAc4907a4Ab4b7866562B7';
  const MockToken_ADDRESS = '0x92d089173611D91256FE4711b97c030955E2A235';
  const MocksFTM_ADDRESS = '0x979430a3B29B60A69D3220E5595E188e7A4a01D2';
  const StakeTokenizer_ADDRESS = '0xD09196C7eF1Ff46c214AF55628f703C4b2D67218';
  const SFCToFMint_ADDRESS = '0x12Aa5683FEe5cFE6D0563B4EE9631EcD1B1CB74c';
  const NetworkInitializer_ADDRESS = '0xcA7E313d6ACdA529Af73781889D7CBF15F3F2Ea9';
  const ConstantManager_ADDRESS = '0x26000893B67be057141d3416559DEB5912041105';
  const MockPriceOracleProxy_ADDRESS = '0x65C1f2492f88ad6e860b55D3B7Cc6BbEe4E8A1cE';
  const FantomMint_ADDRESS = '0x2cd6F0Bb714580034cEDB4eDfE02D0AE17322f5A';
  const FantomMintTokenRegistry_ADDRESS = '0x435aD230786049209Ff0DbdE426A7934b35ff951';
  const CollateralPool_ADDRESS = '0xaDD94CeE531d200ad2707eF8f6F21F7CA6856E1e';
  const FantomFUSD_ADDRESS = '0xafd3bDe4A296891115FbeDABBA4C85D8156B598d';
  const FantomLiquidationManager_ADDRESS = '0xc127dAA3A9C1E5371Fb49e30667e68E03231dfe8';
  
  contract('FantomLiquidationManager', function([
    firstValidator,
    borrower,
    secondBorrower,
    liquidator,
    secondLiquidator
  ]) {
    before(async function() {
        provider = ethers.provider;

        this.sfc = await SFCI.at(SFC_ADDRESS);
        const nodeIRaw = await NodeDriver.at(NodeDriver_ADDRESS);
        const evmWriter = await StubEvmWriter.at(StubEvmWriter_ADDRESS);
        this.nodeI = await NodeDriverAuth.at(NodeDriverAuth_ADDRESS);
        this.sfcLib = await SFCLib.at(SFCLib_ADDRESS);
        this.mockToken = await MockToken.at(MockToken_ADDRESS);
        this.mocksFTM = await MockToken.at(MocksFTM_ADDRESS);
        this.stakeTokenizer = await StakeTokenizer.at(StakeTokenizer_ADDRESS);
        this.sfcToMint = await SFCToFMint.at(SFCToFMint_ADDRESS);
        this.consts = await ConstantsManager.at(ConstantManager_ADDRESS);
        this.fantomMint = await FantomMint.at(FantomMint_ADDRESS);
        this.fantomMintTokenRegistry = await FantomMintTokenRegistry.at(FantomMintTokenRegistry_ADDRESS);
        this.mockPriceOracleProxy = await MockPriceOracleProxy.at(MockPriceOracleProxy_ADDRESS);
        this.collateralPool = await FantomDeFiTokenStorage.at(CollateralPool_ADDRESS);
        this.fantomFUSD = await FantomFUSD.at(FantomFUSD_ADDRESS);
        this.fantomLiquidationManager = await FantomLiquidationManager.at(FantomLiquidationManager_ADDRESS);

        await this.sfc.createValidator(pubkey, {
            from: borrower,
            value: amount18('1000')
          });

        await this.sfc.createValidator(pubkey, {
            from: secondBorrower,
            value: amount18('1000')
        });

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

        await this.mockPriceOracleProxy.setPrice(
             this.mockToken.address,
             etherToWei(1)
        );

        await this.mockPriceOracleProxy.setPrice(
            this.fantomFUSD.address,
            etherToWei(1)
        );

        await this.fantomFUSD.mint(liquidator, etherToWei(10000), {
            from: firstValidator
          });
      
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
            expect(weiToEther(maxToMint) * 1).to.be.lessThanOrEqual(333);
        });

        it('should mint maximium (333) amount of fUSD', async function() {
            //mint maximum amount possible of fUSD for borrower
            await this.fantomMint.mustMintMax(this.fantomFUSD.address, 30000, {
              from: borrower
            });
      
            const fUSDBalance = await this.fantomFUSD.balanceOf(borrower);
            totalSupply = weiToEther(await this.fantomFUSD.totalSupply());
      
            expect(weiToEther(fUSDBalance) * 1).to.be.lessThanOrEqual(333);
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
    
        it('(second borrower) should have locked stake [1]', async function() {
          lockedStake = await this.sfc.getLockedStake(secondBorrower, testValidator2ID);
          expect(weiToEther(lockedStake) * 1).to.be.equal(1);
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
  