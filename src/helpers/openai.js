import { fetch } from "@tauri-apps/plugin-http";
import OpenAI from "openai";

const OpenAIClient = (apiKey) => {
    // Model configuration
    const model = "gpt-4o";
    const maxTokens = 4096;
    const temperature = 0.2;
    const baseUrl = "https://api.openai.com/v1";

    const client = new OpenAI({
        apiKey: apiKey,
        dangerouslyAllowBrowser: true,
    });

    const createChatCompletion = async (messages) => {
        return client.chat.completions.create({
            messages: messages,
            model: model,
        });
    };

    return {
        createChatCompletion,
    };
};

export default OpenAIClient;
