import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const JUPITER_API_URL = process.env.JUPITER_API_URL;
async function getQuote(inputMint, outputMint, amount, slippageBps) {
    try {
        const response = await axios.get(`${JUPITER_API_URL}/quote`, { 
            params: {
                inputMint,
                outputMint,
                amount,
                slippageBps
            },
        });

        // Log the full response for debugging purposes
        console.log('Quote Response:', response.data);

        // Check for success
        if (response.status !== 200 || !response.data || !response.data.routePlan) {
            throw new Error(`Failed to fetch a valid quote. Response: ${JSON.stringify(response.data)}`);
        }

        return response.data;

    } catch (error) {
        // Log the error in case of failure
        console.error("Error fetching quote:", error.message);

        // Additional logging to capture the error details
        if (error.response) {
            console.error("API Response Error:", error.response.data);
            console.error("HTTP Status Code:", error.response.status);
        } else if (error.request) {
            console.error("No response received. Request details:", error.request);
        } else {
            console.error("Unexpected error:", error.message);
        }

        throw new Error("Unable to get quote");
    }
}



async function getSwapInstructions(quoteResponse, userPublicKey) {
    const response = await axios.post(`${JUPITER_API_URL}/swap-instructions`, {
        quoteResponse,
        userPublicKey,
        wrapUnwrapSOL: true,
    })
    return response.data;
}

export {
    getQuote,
    getSwapInstructions,
};