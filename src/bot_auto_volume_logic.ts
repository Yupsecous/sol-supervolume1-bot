import assert from 'assert';

import { NATIVE_MINT } from '@solana/spl-token';

import * as database from './db';
import * as utils from './utils';
import * as constants from './uniconst';
import * as bot from './bot';
import * as global from './global';
import * as fastSwap from "./fast_swap";

import * as jitoBundler from "./jito_bundler"
import { PublicKey } from '@solana/web3.js';

const LookUpTableMap = new Map()

const jito_bundler = new jitoBundler.JitoBundler()

export const registerToken = async (
    chatid: string, // this value is not filled in case of web request, so this could be 0
    addr: string,
    symbol: string,
    decimal: number
) => {
    if (await database.selectToken({ chatid, addr })) {
        return constants.ResultCode.SUCCESS
    }
    const regist = await database.registToken({ chatid, addr, symbol, decimal })
    if (!regist) {
        return constants.ResultCode.INTERNAL
    }
    return constants.ResultCode.SUCCESS
};

const botRun = async (chatid: string, addr: string) => {
    const user: any = await database.selectUser({ chatid })
    const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet)
    const token: any = await database.selectToken({ chatid, addr })

    if (token.status === false) {
        await sellAllTokens(chatid, addr)
        return;
    }

    if (await utils.getWalletSOLBalance(depositWallet) < constants.JITO_BUNDLE_TIP * 5) {
        stop(chatid, addr)
        await bot.openMessage(chatid, "", 0, "Deposit wallets is drained. Please charge some sol for Jito fee.")
        return;
    }

    try {
        const poolKeys: any = await fastSwap.loadPoolKeys_from_market(token.addr, token.decimal)

        if (poolKeys) {
            const solPrice = await utils.getSOLPrice()
            const solBalance = await utils.getWalletSOLBalance(depositWallet)
            const tokenBalance = await utils.getWalletTokenBalance(depositWallet, token.addr, token.decimal)
            let bundleTransactions: any[] = [];
            let bundleInstructions: any[] = []
            let bundleCaller: any[] = []

            const buySolAmount: number = parseFloat((solBalance * (token.buyAmount / 100)).toFixed(5))
            // const canOutAmount: any = await fastSwap.calcAmountOut(poolKeys, buySolAmount, NATIVE_MINT.toString() == poolKeys.baseMint.toString())
            let lastBuySolAmount: number = buySolAmount
            for (let i = 0; i < 7; i++) {
                if (token.status === false) {
                    await sellAllTokens(chatid, addr)
                    return;
                }

                const buyInsts = await fastSwap.getBuyInstructions(depositWallet, lastBuySolAmount, fastSwap.PoolKeysMap.get(token.addr))
                bundleCaller.push(buyInsts.instructions)
                const sellTokenAmount: number = parseFloat(buyInsts.amount.toFixed(5))
                const sellInsts = await fastSwap.getSellInstructions(depositWallet, i == 6 ? sellTokenAmount + tokenBalance : sellTokenAmount, fastSwap.PoolKeysMap.get(token.addr))
                bundleCaller.push(sellInsts.instructions)
                lastBuySolAmount = parseFloat((sellInsts.amount).toFixed(5)) * 1.05
            }
            // bundleCaller = await Promise.all(bundleCaller)
            console.log(bundleCaller.length);

            for (let i = 0; i < bundleCaller.length; i++) {
                console.log(bundleCaller[i].length);
                console.log(bundleInstructions.length);

                bundleInstructions = bundleInstructions.concat(bundleCaller[i].slice(1, 5))
                if (bundleInstructions.length >= 12) {
                    bundleTransactions.push(await fastSwap.getVersionedTransaction([depositWallet.wallet], bundleInstructions, LookUpTableMap.get(token.addr)))
                    bundleInstructions = []
                }
            }
            console.log(bundleInstructions.length);
            if (bundleInstructions.length) {
                bundleInstructions.push(fastSwap.getTransferSOLInst(depositWallet, constants.JITO_TIP_ACCOUNT, constants.JITO_BUNDLE_TIP))
                bundleTransactions.push(await fastSwap.getVersionedTransaction([depositWallet.wallet], bundleInstructions, LookUpTableMap.get(token.addr)))
                bundleInstructions = []
            }
            // bundleTransactions = await Promise.all(bundleTransactions)
            const result: boolean = await jito_bundler.sendBundles(bundleTransactions, null, 2)

            if (result) {
                token.currentVolume += buySolAmount * 2 * 7 * solPrice
                await token.save()
                console.log("------jito request is successed------");
            } else {
                console.log("------jito request is failed------");
            }

        }
    } catch (error) {
        console.log("=========== An Error Occured, Retrying ==========", error)
    }

    const now: number = new Date().getTime()
    token.workingTime += (now - token.lastWorkedTime)
    token.lastWorkedTime = now
    if (token.targetVolume * constants.VOLUME_UNIT < token.currentVolume) {
        token.status = false
    }
    await token.save()
}


const sellAllTokens = async (chatid: string, addr: string) => {
    const user: any = await database.selectUser({ chatid })
    const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet)
    const token: any = await database.selectToken({ chatid, addr })
    const tokenBalance: number = await utils.getWalletTokenBalance(
        depositWallet,
        token.addr, token.decimal
    );
    if (!tokenBalance) {
        return
    }
    console.log("selling all tokens");
    const poolKeys: any = await fastSwap.loadPoolKeys_from_market(token.addr, token.decimal)
    if (poolKeys) {
        const sellInsts: any = await fastSwap.getSellInstructions(depositWallet, tokenBalance, poolKeys)
        const versionedTransaction = await fastSwap.getVersionedTransaction([depositWallet.wallet], sellInsts.instructions, null)
        const result = await jito_bundler.sendBundles([versionedTransaction], depositWallet, 4)
        console.log("selling", result);
    }
}

export const start = async (
    chatid: string,
    addr: string,
): Promise<constants.ResultCode> => {
    assert(chatid);
    assert(addr);

    const user: any = await database.selectUser({ chatid })
    if (!user) {
        return constants.ResultCode.INTERNAL
    }
    const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet)

    const token: any = await database.selectToken({ chatid, addr })
    if (!token) {
        return constants.ResultCode.INTERNAL
    }

    const poolKeys: any = await fastSwap.loadPoolKeys_from_market(token.addr, token.decimal)

    if (!poolKeys) {
        return constants.ResultCode.INTERNAL
    }

    if (token.lookupTableAddr && token.lookupTableAddr != "") {
        const lookupTableAccount: any = (await global.web3Conn.getAddressLookupTable(new PublicKey(token.lookupTableAddr), { commitment: "finalized" })).value
        LookUpTableMap.set(token.addr, lookupTableAccount)
        console.log("lookup table loaded");
    }

    if (!token.lookupTableAddr || token.lookupTableAddr == "") {
        console.log("lookup table creating");
        const createLookupTable = await fastSwap.getCreateLookUpTableTransaction(depositWallet, poolKeys)
        await jito_bundler.sendBundles(createLookupTable.transactions, depositWallet, 10)
        token.lookupTableAddr = createLookupTable.address.toString()

        for (let index = 0; index < 20; index++) {
            await utils.sleep(1000)
            const lookupTableAccount: any = (await global.web3Conn.getAddressLookupTable(new PublicKey(token.lookupTableAddr), { commitment: "finalized" })).value
            if (lookupTableAccount) {
                LookUpTableMap.set(token.addr, lookupTableAccount)
                break
            }
        }
        console.log("lookup table created");
    }

    if (!(await utils.IsTokenAccountInWallet(depositWallet, token.addr))) {
        let bundleInstructions: any[] = []
        bundleInstructions.push(fastSwap.getPriorityFeeInst())
        bundleInstructions.push(fastSwap.getCreateAccountTransactionInst(depositWallet, depositWallet, token.addr))
        const versionedTransaction = await fastSwap.getVersionedTransaction([depositWallet.wallet], bundleInstructions, null)
        await jito_bundler.sendBundles([versionedTransaction], depositWallet, 10)
    }

    token.status = true
    token.lastWorkedTime = new Date().getTime()
    setInterval(() => botRun(chatid, addr), constants.MINUTE / token.ratingPer1H)
    await token.save()
    return constants.ResultCode.SUCCESS
};

export const stop = async (chatid: string, addr: string) => {
    assert(addr);

    const token: any = await database.selectToken({ chatid, addr })
    if (!token) {
        return
    }
    // await sellAllTokens(chatid, addr)
    token.status = false
    await token.save()
}

export const withdraw = async (chatid: string, addr: string) => {
    const user: any = await database.selectUser({ chatid })
    if (!user) {
        return false
    }
    const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet)
    let depositWalletSOLBalance: number = await utils.getWalletSOLBalance(depositWallet)
    if (depositWalletSOLBalance <= 0.01) {
        return false
    }
    const session = bot.sessions.get(chatid)
    const token: any = await database.selectToken({ chatid, addr: session.addr })
    const tax = (token.currentVolume / constants.VOLUME_UNIT) * constants.TAX_AMOUNT
    if (depositWalletSOLBalance < tax) {
        const transferSol = fastSwap.getTransferSOLInst(depositWallet, global.get_tax_wallet_address(), depositWalletSOLBalance - 0.01)
        const versionedTransaction = await fastSwap.getVersionedTransaction([depositWallet.wallet], [transferSol], null)
        await jito_bundler.sendBundles([versionedTransaction], depositWallet, 4)
        return false
    }
    const transferSol = fastSwap.getTransferSOLInst(depositWallet, addr, depositWalletSOLBalance - tax - 0.01)
    const transferTax = fastSwap.getTransferSOLInst(depositWallet, global.get_tax_wallet_address(), tax)
    const versionedTransaction = await fastSwap.getVersionedTransaction([depositWallet.wallet], [transferSol, transferTax], null)
    const result: boolean = await jito_bundler.sendBundles([versionedTransaction], depositWallet, 4)
    if (result) {
        console.log("------withdraw success------");
    } else {
        console.log("------withdraw failed------");
    }
    return true
}

export const setTargetAmount = async (chatid: string, addr: string, amount: number) => {
    const token: any = await database.selectToken({ chatid, addr })
    token.targetVolume = amount
    await token.save()
    return true
}

export const setRating = async (chatid: string, addr: string, amount: number) => {
    const token: any = await database.selectToken({ chatid, addr })
    token.ratingPer1H = amount
    await token.save()
    return true
}

export const setBuyAmount = async (chatid: string, addr: string, amount: number) => {
    const token: any = await database.selectToken({ chatid, addr })
    token.buyAmount = amount
    await token.save()
    return true
}

export const setWalletSize = async (chatid: string, addr: string, size: number) => {
    const token: any = await database.selectToken({ chatid, addr })
    token.walletSize = size
    await token.save()
    return true
}
