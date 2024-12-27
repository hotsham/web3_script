import { readFileSync } from 'fs';
import { BigNumber, ethers, Wallet } from 'ethers';
import UsdcTokenJson from './abis_2/ERC20Usdc.json' with { type: 'json' };
import IDexModuleJson from './abis_2/IDexModule.json' with { type: 'json' };
import HoneyTokenJson from './abis_2/ERC20Honey.json' with { type: 'json' };
import MintHoneyJson from './abis_2/MintHoney.json' with { type: 'json' };
import AddLiquidtyJson from './abis_2/IAddLiquidtyModule.json' with { type: 'json' };
import LiquidtyPoolJson from './abis_2/HoneyAndUsdcLiquidtyPool.json' with { type: 'json' };
import RewardsJson from './abis_2/HoneyAndUsdcRewards.json' with { type: 'json' };
import IBankJson from './abis_2/IBankModule.json' with { type: 'json' };
import IStakingJson from './abis_2/IStakingModule.json' with { type: 'json' };
import BGTJson from './abis_2/ERC20Bgt.json' with { type: 'json' };

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const originalConsoleLog = console.log;
console.log = function (...args) {
    const currentTime = new Date();
    const timestamp = `[${currentTime.toISOString()}]`;
    originalConsoleLog.apply(console, [timestamp, ...args]);
};

const msleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

async function swaprun() {
    const csvPath = process.env.CSVPath;
    const rpcUrl = process.env.RPC;
    const WalletIdxList= process.env.WALLETIDXLIST.split(',');

    if (!csvPath || !rpcUrl) {
        console.error('Missing environment variables');
        return;
    }

    const arr = readFileSync(csvPath, 'UTF8').split('\n');
    const mnemonicRegex = /^[a-zA-Z]+( +[a-zA-Z]+)*$/;
    const path = "m/44'/60'/0'/0/0";
    const provider = ethers.getDefaultProvider(rpcUrl);

    for (let index = 0; index < arr.length - 1; index++) {
        try {
            const element = arr[index];
            const isMnemonic = mnemonicRegex.test(element)

            const remainingIndices = new Set(WalletIdxList);

            while (remainingIndices.size > 0) {
                const randomIndex = Array.from(remainingIndices)[getRandomInt(remainingIndices.size)];
                remainingIndices.delete(randomIndex);

                let wallet;
                if (isMnemonic) {
                    wallet = Wallet.fromMnemonic(element, path + randomIndex).connect(provider);
                } else {
                    wallet = new Wallet(element, provider);
                }

                console.log('==========start======index:', index, "pathid:", randomIndex, ' ,address:', wallet.address);

                const contracts = setupContracts(wallet);
                try {
                    await processWallet(provider, wallet, contracts);
                } catch (error) {
                    console.error('processWallet error:', error);
                }
                console.log("==========end====== wallet'address:", wallet.address);

                await msleep(5 * 1000);

                if (!isMnemonic) {
                    break;
                }
            }
        } catch (error) {
            console.error('error:', error);
            continue;
        }
    }
}

function setupContracts(wallet) {
    return {
        dex: new ethers.Contract(IDexModuleJson.address, IDexModuleJson.abi, wallet),
        usdc: new ethers.Contract(UsdcTokenJson.address, UsdcTokenJson.abi, wallet),
        mintHoney: new ethers.Contract(MintHoneyJson.address, MintHoneyJson.abi, wallet),
        ercHoney: new ethers.Contract(HoneyTokenJson.address, HoneyTokenJson.abi, wallet),
        rewardsContract: new ethers.Contract(RewardsJson.address, RewardsJson.abi, wallet),
        //bank: new ethers.Contract(IBankJson.address, IBankJson.abi, wallet),
        //staking: new ethers.Contract(IStakingJson.address, IStakingJson.abi, wallet),
        addLiquidty: new ethers.Contract(AddLiquidtyJson.address, AddLiquidtyJson.abi, wallet),
        liquidityPool : new ethers.Contract(LiquidtyPoolJson.address, LiquidtyPoolJson.abi, wallet),
        ercBgt: new ethers.Contract(BGTJson.address, BGTJson.abi, wallet),
    };
}




async function processWallet(provider,wallet, contracts) {
    try {
        const {  dex, usdc, mintHoney, ercHoney, ercBgt,rewardsContract/*, bank, staking*/ ,addLiquidty,liquidityPool} = contracts;

        const actions = [
            // swap if need
            () => shouldSwapIfNeed(provider, wallet, dex, usdc),
              // mint honey if need
            () => shouldMintHoneyIfNeed(provider, wallet, mintHoney, usdc, ercHoney),
            // add liquidity if need
            () => addLiquidityIfNeed(provider, wallet, addLiquidty, usdc, ercHoney),
            // do liquidity pool stake
            () => stakeLiquidityPoolIfNeed(provider, wallet, rewardsContract, liquidityPool),
             // claim rewards
            () => claimRewardsIfNeed(provider, wallet, rewardsContract),
            // delegate ABGTIfNeed
            () => delegateABGTIfNeed(provider, wallet, ercBgt),
            // activete boost
            () => activateBoostIfNeed(provider, wallet, ercBgt)
        ];

        // 打乱执行顺序
        for (let i = actions.length - 1; i > 0; i--) {
            const j = getRandomInt(i + 1);
            [actions[i], actions[j]] = [actions[j], actions[i]];
        }

        // 顺序执行随机排列后的动作
        for (const action of actions) {
            await action();
        }

    } catch (error) {
        console.error('error:', error);
    }
}

async function shouldSwapIfNeed(provider,wallet,dex,usdc) {
    console.log('shouldSwapIfNeed ...');
    let balanceOfUsdc = await usdc.balanceOf(wallet.address);
    let balanceOfBera = await provider.getBalance(wallet.address);
    console.log('balanceOfBera:', balanceOfBera.toString(), 'balanceOfUsdc:', balanceOfUsdc.toString());
    const minSwapAmount = process.env.MINSWAPAMOUNT;
    //console.log("minSwapAmount:",balanceOfETH.gt(ethers.utils.parseEther(minSwapAmount)), balanceOfUsdc.toString(),ethers.utils.parseEther(`0.1`).div(1e12).toString());
    if (balanceOfBera.gt(ethers.utils.parseEther(minSwapAmount)) && balanceOfUsdc.lt(ethers.utils.parseEther(`0.1`).div(1e12))) {
        const minSwapAmount = process.env.MINSWAPAMOUNT;
        //const swapAmount = balanceOfETH.sub(ethers.utils.parseEther(minSwapAmount));
        const swapStep = [
            [
                UsdcTokenJson.poolid,
                `0x0000000000000000000000000000000000000000`,
                UsdcTokenJson.address,
                true
            ],
        ];
        const swapvalue = ethers.utils.parseEther(minSwapAmount);
        console.log( 'swapvalue:', swapvalue.toString() );
        // const estimateGasSwap = await provider.estimateGas({
        //     from: wallet.address,
        //     to: dex.address,
        //     data: dex.interface.encodeFunctionData(`multiSwap`, [swapStep ,swapvalue,0])
        // })
        //console.log( 'estimateGasSwap:', estimateGasSwap.toString() );
        const swaptx = await dex.multiSwap(swapStep,swapvalue,0,{ value :swapvalue, /*gasLimit: estimateGasSwap.mul(5) */});
        console.log('swap hash:', swaptx.hash);
        await swaptx.wait();
        await msleep(30 * 1000);
    }
}



async function shouldMintHoneyIfNeed(provider,wallet,mintHoney,usdc,ercHoney) {
    console.log('shouldMintHoneyIfNeed ...');
    let balanceOfHoney = await ercHoney.balanceOf(wallet.address);
    let balanceOfUsdc = await usdc.balanceOf(wallet.address);
    console.log('balanceOfHoney:', balanceOfHoney.toString(),'balanceOfUsdc:', balanceOfUsdc.toString());

    if ( balanceOfUsdc.gt(ethers.utils.parseEther(`0.1`).div(1e12)) && balanceOfHoney.lte(ethers.utils.parseEther(`0.1`))) {
        const allowValue = await usdc.allowance(wallet.address, MintHoneyJson.address);
        const mintAmount = balanceOfUsdc.mul(50).div(100);

        if (allowValue.lt(mintAmount)) {
            const appvret = await usdc.approve(MintHoneyJson.address, mintAmount);
            await appvret.wait();
            console.log('Usdc approve:', appvret.hash);
            await msleep(30 * 1000);
        }
        const estimateGasMint = await provider.estimateGas({
            from: wallet.address,
            to: mintHoney.address,
            data: mintHoney.interface.encodeFunctionData(`mint`, [UsdcTokenJson.address,mintAmount, wallet.address ])
        })
        const gasPrice = await provider.getGasPrice()
        const txMint = await mintHoney.mint( UsdcTokenJson.address, mintAmount,wallet.address, { gasLimit: estimateGasMint.mul(5) ,gasPrice});
        console.log('mint txhash:', txMint.hash);
        await txMint.wait();
    }
}

async function addLiquidityIfNeed(provider, wallet, addLiquidty, usdc, ercHoney) {
    console.log('addLiquidityIfNeeded ...');
    const balanceOfHoney = await ercHoney.balanceOf(wallet.address);
    const balanceOfUsdc = await usdc.balanceOf(wallet.address);
    console.log('balanceOfHoney:', balanceOfHoney.toString(), 'balanceOfUsdc:', balanceOfUsdc.toString());
    if (balanceOfUsdc.gt(ethers.utils.parseEther(`0`)) && balanceOfHoney.gt(ethers.utils.parseEther(`0`))) {
        // approve token
        await approveIfNeeded(wallet, usdc, balanceOfUsdc, addLiquidty.address);
        await approveIfNeeded(wallet, ercHoney, balanceOfHoney, addLiquidty.address);

        // fetch ${limitLower} and ${limitHigher}
        const priceOrigin = await provider.call({
            to: `0x8685ce9db06d40cba73e3d09e6868fe476b5dc89`,
            // queryPrice (address base, address quote, uint256 poolIdx) public view returns (uint128)
            data: `0xf8c7efa70000000000000000000000000e4aaf1351de4c0264c5c7056ef3777b41bd8e03000000000000000000000000d6d83af58a19cd14ef3cf6fe848c9a4d21e5727c0000000000000000000000000000000000000000000000000000000000008ca0`,
        })
        const price = BigNumber.from(priceOrigin)
        console.log("fetched limit:", price.toString())

        const cmd = (new ethers.utils.AbiCoder()).encode(
            ['uint8','address','address' ,'uint256', 'int24', 'int24','uint128', 'uint128','uint128','uint8','address'],
            [31,HoneyTokenJson.address,UsdcTokenJson.address,UsdcTokenJson.poolid,0,0,balanceOfHoney,price.mul(95).div(100),price.mul(105).div(100),0,LiquidtyPoolJson.address]);
        // get gas price
        const estimateGasUserCmd = await provider.estimateGas({
            from: wallet.address,
            to: addLiquidty.address,
            data: addLiquidty.interface.encodeFunctionData(`userCmd`, [128, cmd])
        })
        const addLiqgasPrice = await provider.getGasPrice()
        //console.log('addLiquidity pre:',estimateGasUserCmd.toString() );
        const retLiq = await addLiquidty.userCmd(128, cmd, { gasLimit: 300000, gasPrice: addLiqgasPrice });
        console.log('addLiquidity txhash:', retLiq.hash);
        await retLiq.wait();
        await msleep(30 * 1000);
    }
}

async function stakeLiquidityPoolIfNeed(provider,wallet,rewardsContract,liquidityPool) {
    console.log('stakeLiquidityPoolIfNeed ...');
    const lpBalance = await liquidityPool.balanceOf(wallet.address);
    console.log('lpBalance:', lpBalance.toString());
    if (lpBalance.gt(ethers.utils.parseEther(`0`))) {
        const appvret = await liquidityPool.approve(RewardsJson.address, lpBalance);
        //console.log('lp stakeapprove:', appvret.hash);
        await appvret.wait();
        try {
            //cat stake gas price
            const estimateGasStake = await provider.estimateGas({
                from: wallet.address,
                to: rewardsContract.address,
                data: rewardsContract.interface.encodeFunctionData(`stake`, [lpBalance])
            })
            const stakeTx = await rewardsContract.stake(lpBalance, { gasLimit: estimateGasStake.mul(5), gasPrice: await provider.getGasPrice()});
            console.log('stake txhash:', stakeTx.hash);
            await stakeTx.wait();
        } catch (error) {
            console.log('Gas estimation or transaction failed:', error);
        }
    }

}


async function approveIfNeeded(wallet, tokenContract, amount, spender) {
    const allowance = await tokenContract.allowance(wallet.address, spender);
    if (allowance.lt(amount)) {
        const appvret = await tokenContract.approve(spender, amount);
        console.log(`${tokenContract.address} approve:`, appvret.hash);
        await appvret.wait();
    }
}

async function claimRewardsIfNeed(provider,wallet,rewardsContract ) {
    console.log('claimRewardsIfNeeded ...');
    const getRewardResp = await provider.call({
        to: rewardsContract.address,
        data: rewardsContract.interface.encodeFunctionData(`getReward`, [wallet.address])
    })
    const rewardbalance = BigNumber.from(getRewardResp)
    console.log('rewardbalance:', rewardbalance.toString());
    if (rewardbalance.gt(ethers.utils.parseEther(`0`))) {
        //call gas price
        const estimateGasgetReward= await provider.estimateGas({
            from: wallet.address,
            to: rewardsContract.address,
            data: rewardsContract.interface.encodeFunctionData(`getReward`, [wallet.address]),
        });

        const rewards = await rewardsContract.getReward(wallet.address, { gasLimit: estimateGasgetReward.mul(5)});
        console.log('cliam rewardstxhash:', rewards.hash);
        await rewards.wait();
    }
}

async function delegateABGTIfNeed(provider,wallet,etcBgtContract) {
    console.log("delegateABGTIfNeed ...")
    const unboost_bgtbalance = await etcBgtContract.unboostedBalanceOf(wallet.address);
    console.log('erc unboost_bgtbalance:', unboost_bgtbalance.toString());
    if (unboost_bgtbalance.gt(ethers.utils.parseEther(`0`))) {
        const validatorIds = process.env.VALIDATORIDS.split(',');
        const validatorAddress = validatorIds[Math.floor(Math.random() * validatorIds.length)];

        const estimateGasQueueBoost = await provider.estimateGas({
            from: etcBgtContract.address,
            to: validatorAddress,
            data: etcBgtContract.interface.encodeFunctionData(`queueBoost`, [validatorAddress,unboost_bgtbalance])
        });
        const queueBoost = await etcBgtContract.queueBoost(validatorAddress, unboost_bgtbalance,{gasLimit: estimateGasQueueBoost.mul(5), gasPrice: await provider.getGasPrice()});
        console.log('abgt delegateABGT:', queueBoost.hash);
        await queueBoost.wait();
    }
}

async function activateBoostIfNeed(provider,wallet ,etcBgtContract) {
    console.log("activateBoost ...")
    const validatorIds = process.env.VALIDATORIDS.split(',');

    for (let i = 0; i < validatorIds.length; i++) {
        const validatorAddress = validatorIds[i];
        const estimateGasActivateBoost = await provider.estimateGas({
            from: etcBgtContract.address,
            to: validatorAddress,
            data: etcBgtContract.interface.encodeFunctionData(`activateBoost`, [validatorAddress])
        });
        const boostedQueue = await etcBgtContract.boostedQueue(wallet.address,validatorAddress);
        //const lastBoostBlock = await provider.getBlockNumber()
        //console.log('abgt boostedQueue validator:', validatorAddress, "blockNumber:", lastBoostBlock - boostedQueue.blockNumberLast, "balance:", boostedQueue.balance.toString(),);

        if (boostedQueue.balance.gt(ethers.utils.parseEther(`0`)) && boostedQueue.blockNumberLast < (await provider.getBlockNumber()) - 8191 ) {
            const activateBoost = await etcBgtContract.activateBoost(validatorAddress, {gasLimit: estimateGasActivateBoost.mul(10), gasPrice: await provider.getGasPrice()});
            console.log('abgt activateBoost hash:', activateBoost.hash);
            await activateBoost.wait();
        }
    }
}

async function divideCoin() {
    console.log("divideCoin=====>>>>>>>");
    const csvPath = process.env.CSVPath;
    const rpcUrl = process.env.RPC;
    const WalletIdxList= process.env.WALLETIDXLIST.split(',');
    const divideAmount = process.env.DIVIDEAMOUNT;
    if (!csvPath || !rpcUrl) {
        console.error('Missing environment variables');
        return;
    }

    const arr = readFileSync(csvPath, 'UTF8').split('\n');
    const mnemonicRegex = /^[a-zA-Z]+( +[a-zA-Z]+)*$/;
    const path = "m/44'/60'/0'/0/0";
    const provider = ethers.getDefaultProvider(rpcUrl);
    const mainWallet = Wallet.fromMnemonic(process.env.MAINMNEMONIC).connect(provider);
    console.log(" mainWallet:",mainWallet.address,await provider.getBalance(mainWallet.address),ethers.utils.parseEther(divideAmount).toString());
    for (let index = 0; index < arr.length; index++) {
        try {
            const element = arr[index];
            for (let id = 0; id < WalletIdxList.length; id++) {
                let wallet;
                const pathid = WalletIdxList[id];
                const isMnemonic = mnemonicRegex.test(element);
                if (mnemonicRegex.test(element)) {
                    wallet = Wallet.fromMnemonic(element,path + pathid).connect(provider);
                } else {
                    wallet = new Wallet(element, provider);
                }
                const mainBalance = await provider.getBalance(mainWallet.address);
                if (mainBalance.lt(ethers.utils.parseEther(divideAmount))){
                    return;  
                }
                const transftx = await mainWallet.sendTransaction({
                    to: wallet.address,
                    value: ethers.utils.parseEther(divideAmount)
                })
                await transftx.wait();
                console.log(`transfer txHash: ${transftx.hash}`);

                await msleep(5*1000)
                if (!isMnemonic) {
                    break
                }          
            }
        } catch (error) {
            console.error('error:', error);
            continue;
        }
    }
}


async function main() {
	await divideCoin();	
	await swaprun();
}

main();
