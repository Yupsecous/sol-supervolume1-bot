import base58 from 'bs58';
import { searcherClient } from 'jito-ts/dist/sdk/block-engine/searcher';
import { Bundle } from 'jito-ts/dist/sdk/block-engine/types';

import {
	LAMPORTS_PER_SOL,
	PublicKey,
} from '@solana/web3.js';

import * as global from './global';
import * as utils from './utils';

export const createAndSendBundleTransaction = async (bundleTransactions: any, payer: any, apiKey: string, fee: number) => {
	const wallet = utils.getWalletFromPrivateKey(apiKey)
	const seacher = searcherClient(
		global.get_jito_block_api(),
		wallet.wallet
	);

	let transactionsConfirmResult: boolean = false
	let breakCheckTransactionStatus: boolean = false
	try {
		const recentBlockhash = (await global.web3Conn.getLatestBlockhash("finalized")).blockhash;
		let bundleTx = new Bundle(bundleTransactions, 5);
		if (payer) {
			const tipAccount = new PublicKey((await seacher.getTipAccounts())[0]);
			bundleTx.addTipTx(payer, fee * LAMPORTS_PER_SOL, tipAccount, recentBlockhash);
		}

		seacher.onBundleResult(
			async (bundleResult: any) => {
				if (bundleResult.rejected) {
					try {
						if (bundleResult.rejected.simulationFailure.msg.includes("custom program error") ||
							bundleResult.rejected.simulationFailure.msg.includes("Error processing Instruction")) {
							breakCheckTransactionStatus = true
						}
						else if (bundleResult.rejected.simulationFailure.msg.includes("This transaction has already been processed") ||
							bundleResult.rejected.droppedBundle.msg.includes("Bundle partially processed")) {
							transactionsConfirmResult = true
							breakCheckTransactionStatus = true
						}
					} catch (error) {
					}
				}
			},
			(error) => {
				breakCheckTransactionStatus = true
			}
		);
		await seacher.sendBundle(bundleTx);
		setTimeout(() => { breakCheckTransactionStatus = true }, 20000)
		const trxHash = base58.encode(bundleTransactions[bundleTransactions.length - 1].signatures[0])
		while (!breakCheckTransactionStatus) {
			await utils.sleep(500)
			try {
				const result = await global.web3Conn.getSignatureStatus(trxHash, {
					searchTransactionHistory: true,
				});
				if (result && result.value && result.value.confirmationStatus) {
					transactionsConfirmResult = true
					breakCheckTransactionStatus = true
				}
			} catch (error) {
				transactionsConfirmResult = false
				breakCheckTransactionStatus = true
			}
		}
		return transactionsConfirmResult
	} catch (error) {
		return false
	}
};

