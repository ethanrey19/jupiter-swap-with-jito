import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { deserializeInstruction, getAddressLookupTableAccounts, simulateTransaction, createVersionedTransaction } from "./transactionUtils.js";
import { getTokenDecimals, getAveragePriorityFee } from "./utils.js";
import { getQuote, getSwapInstructions } from "./jupiter-swap.js";
import { createJitoBundle, sendJitoBundle, checkBundleStatus } from "./jitoService.js";
import bs58 from 'bs58';

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
const connection = new Connection(SOLANA_RPC_URL);

const secretKey = bs58.decode(WALLET_PRIVATE_KEY);
const wallet = Keypair.fromSecretKey(secretKey);

async function main() {
    try {
        const inputMint = "So11111111111111111111111111111111111111112"; // Wrapped SOL
        const outputMint = "GaRph5BcLZZ4sRh6EXKS6V7dicVanhcwa5iWEE6AbEYR"; // Tradebot (What token your buying)
        const amount = 0.001; // SOL Amount to send
        const initialSlippageBps = 100; // 1% initial slippage
        const maxRetries = 3;

        console.log("\nStarting swap operation...");
        console.log(`Input: ${amount}`);
        console.log(`Output: Tradebot`);
        console.log(`Initial Slippage: ${initialSlippageBps / 100}%`);

        const result = await swap(inputMint, outputMint, amount, initialSlippageBps, maxRetries);
        console.log(" Swap completed successfully!");
        console.log("Swap result:");
        console.log(JSON.stringify(result.bundleStatus, null, 2));
        console.log("Transaction signature:", result.signature);
        console.log(`View on Solscan: https://solscan.io/tx/${result.signature}`);
    } catch (error) {
        console.error("Error in main function:");
        console.error(error.message);
    }
}

async function swap(inputMint, outputMint, amount, slippageBps, maxRetries) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            console.log("\n========== INITIATING SWAP ==========");
            const inputTokenInfo = await getTokenDecimals(inputMint);
            const outputTokenInfo = await getTokenDecimals(outputMint);

            const adjustedAmount = amount * Math.pow(10, inputTokenInfo.decimals);
            const adjustedSlippageBps = slippageBps * (1 + retries * 0.5);

            // 1. Get quote from Jupiter
            console.log("Getting quote from Jupiter...");
            const quoteResponse = await getQuote(inputMint, outputMint, adjustedAmount, adjustedSlippageBps);

            if (!quoteResponse || !quoteResponse.routePlan) {
                throw new Error("Unable to get quote");
            }

            console.log("Quote received successfully", quoteResponse);

            // 2. Get swap instructions
            console.log("Getting swap instructions...");
            const swapInstructions = await getSwapInstructions(quoteResponse, wallet.publicKey.toString());

            if (!swapInstructions || swapInstructions.error) {
                throw new Error(
                    "Failed to get swap instructions: " +
                    (swapInstructions ? swapInstructions.error : "Unknown error")
                );
            }

            console.log("Swap instructions received successfully", swapInstructions);

            const {
                setupInstructions,
                swapInstruction: swapInstructionPayload,
                cleanupInstruction,
                addressLookupTableAddresses,
            } = swapInstructions;

            const swapInstruction = deserializeInstruction(swapInstructionPayload);
            // 3. Prepare transaction
            console.log("Preparing transaction...");
            const addressLookupTableAccounts = await getAddressLookupTableAccounts(
                addressLookupTableAddresses
            );

            const latestBlockhash = await connection.getLatestBlockhash("finalized");

            // 4. Simulate transaction to get compute units
            const instructions = [
                ...setupInstructions.map(deserializeInstruction),
                swapInstruction,
            ];

            if (cleanupInstruction) {
                instructions.push(deserializeInstruction(cleanupInstruction));
            }

            console.log("Simulating transaction...");
            const computeUnits = await simulateTransaction(
                instructions,
                wallet.publicKey,
                addressLookupTableAccounts,
                5
            );

            if (computeUnits === undefined) {
                throw new Error("Failed to simulate transaction");
            }

            if (computeUnits && computeUnits.error === "InsufficientFundsForRent") {
                console.log("Insufficient funds for rent. Skipping this swap.");
                return null;
            }

            const priorityFee = await getAveragePriorityFee();

            console.log(`Priority fee: ${priorityFee.microLamports} micro-lamports (${priorityFee.solAmount.toFixed(9)} SOL)`);

            // 5. Create versioned transaction
            const transaction = createVersionedTransaction(
                instructions,
                wallet.publicKey,
                addressLookupTableAccounts,
                latestBlockhash.blockhash,
                computeUnits,
                priorityFee
            );

            // 6. Sign the transaction
            transaction.sign([wallet]);

            // 7. Create and send Jito bundle
            console.log("\nCreating Jito bundle...");
            const jitoBundle = await createJitoBundle(transaction, wallet);
            console.log("Jito bundle created successfully");

            console.log("\n Sending Jito bundle...");
            let bundleId = await sendJitoBundle(jitoBundle);
            console.log(`Jito bundle sent. Bundle ID: ${bundleId}`);

            console.log("\n🔍 Checking bundle status...");
            let bundleStatus = null;
            let bundleRetries = 3;
            const delay = 15000; // Wait 15 seconds

            while (bundleRetries > 0) {
                console.log(`⏳ Waiting for 15 seconds before checking status...`);
                await new Promise((resolve) => setTimeout(resolve, delay));

                bundleStatus = await checkBundleStatus(bundleId);

                if (bundleStatus && bundleStatus.status === "Landed") {
                    console.log(`Bundle finalized. Slot: ${bundleStatus.landedSlot}`);
                    break;
                } else if (bundleStatus && bundleStatus.status === "Failed") {
                    console.log("Bundle failed. Retrying...");
                    bundleId = await sendJitoBundle(jitoBundle);
                    console.log(`New Bundle ID: ${bundleId}`);
                } else {
                    console.log(
                        `Bundle not finalized. Status: ${bundleStatus ? bundleStatus.status : "unknown"
                        }`
                    );
                }

                bundleRetries--;
            }

            if (!bundleStatus || bundleStatus.status !== "Landed") {
                throw new Error("Failed to execute swap after multiple attempts.");
            }

            console.log("Swap executed successfully!");
            console.log("========== SWAP COMPLETE ==========\n");

            const signature = bs58.encode(transaction.signatures[0]);
            return { bundleStatus, signature };
        } catch (error) {
            console.error(
                `Error executing swap (attempt ${retries + 1}/${maxRetries}):`
            );
            console.error(error.message);
            retries++;
            if (retries >= maxRetries) {
                console.error(
                    `Failed to execute swap after ${maxRetries} attempts.`
                );
                throw error;
            }
            console.log(`\nRetrying in 2 seconds...`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
}

main();