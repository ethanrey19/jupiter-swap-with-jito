import { Connection, PublicKey} from '@solana/web3.js'; 
import dotenv from 'dotenv';

dotenv.config();
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
const connection = new Connection(SOLANA_RPC_URL);

async function getTokenDecimals(tokenAddress) {
    const tokenAccount = new PublicKey(tokenAddress);
    const tokenInfo = await connection.getParsedAccountInfo(tokenAccount);

    if (!tokenInfo.value || !tokenInfo.value.data || !tokenInfo.value.data.parsed) {
        throw new Error(`Failed to fetch token info for token: ${tokenAddress}`);
      }
    
      const { decimals } = tokenInfo.value.data.parsed.info;
      return { decimals };
}

async function getAveragePriorityFee() {
  const priorityFees = await connection.getRecentPrioritizationFees();
  if (priorityFees.length === 0) {
    return { microLamports: 10000, solAmount: 0.00001 }; // Default to 10000 micro-lamports if no data
  }

  const recentFees = priorityFees.slice(-150); // Get fees from last 150 slots
  const averageFee =
    recentFees.reduce((sum, fee) => sum + fee.prioritizationFee, 0) /
    recentFees.length;
  const microLamports = Math.ceil(averageFee);
  const solAmount = microLamports / 1e6 / 1e3; // Convert micro-lamports to SOL
  return { microLamports, solAmount };
}

export { getTokenDecimals, getAveragePriorityFee };
