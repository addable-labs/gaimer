import { fetch } from "@tauri-apps/plugin-http";
import logger from "./logger";

const OpenAI = (apiKey) => {
    // Model configuration
    const model = "gpt-4o";
    const maxTokens = 4096;
    const temperature = 0.2;
    const baseUrl = "https://api.openai.com/v1";

    // Private function. Sets the fetch init options.
    const setOptions = (messages, stream, abortSignal) => {
        const headers = {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
        };

        const streamOptions = !stream
            ? {}
            : {
                  stream: stream,
                  stream_options: {
                      include_usage: true,
                  },
              };

        const body = {
            model: model,
            messages: messages,
            max_tokens: maxTokens,
            temperature: temperature,
            ...streamOptions,
            n: 1,
        };

        const options = {
            method: "POST",
            headers: headers,
            body: JSON.stringify(body),
            signal: abortSignal,
        };

        return options;
    };

    // Public function. Creates a chat completion.
    const createChatCompletion = async (messages, stream, abortSignal) => {
        // Clean up any undefined elements in the messages array, to avoid failed OpenAI API call.
        messages = messages.filter((message) => message !== undefined);
        const requestOptions = setOptions(
            messages,
            (stream = false),
            (abortSignal = null),
        );

        try {
            const response = await fetch(
                `${baseUrl}/chat/completions`,
                requestOptions,
            );

            if (!response.ok) {
                logger.error(
                    `[openai] - createChatCompletion() error:\n${JSON.stringify(response)}`,
                );
                throw new Error(`${response.status} - ${response.statusText}`);
            }

            return response;
        } catch (error) {
            throw new Error(error.message);
        }
    };

    return {
        createChatCompletion,
    };
};

export default OpenAI;
