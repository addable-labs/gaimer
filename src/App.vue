<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useAppStore } from "./stores/app-store.js";
import { storeToRefs } from "pinia";
import logger from "./helpers/logger.js";
import OpenAI from "./helpers/openai.js";
import UserInput from "./components/UserInput.vue";
import Settings from "./components/Settings.vue";
import GameContainer from "./components/GameContainer.vue";

const appStore = useAppStore();
const { gameDescription, apiKey, generating } = storeToRefs(appStore);

const openAI = OpenAI(apiKey.value);
const assistantMessage = ref({ role: "assistant", content: "" });

const generationDone = ref(false);

const generateGame = async (prompt) => {
    generating.value = true;
    generationDone.value = false;
    let systemMessage = {
        role: "system",
        content: `
            You are an expert in creating HTML5 JavaScript games.
            Given a description of a game, generate only the HTML and JavaScript content that can be directly added to an existing DOM element.

            Do not include the <html>, <head>, or <body> tags.
            Do not use Markdown or code block formatting.
            Only return the plain HTML and JavaScript code.
            Only return the content inside those tags that can be added dynamically to a div or similar container.

            You will receive the game description in the user prompt.

            Important: Do not include any comments, explanations, or any additional text.
            Only include the necessary content.
            Return the plain HTML and JavaScript code.
            `,
    };

    if (prompt == "") {
        prompt =
            "Create a simple pong game with two paddles and a bouncing ball.";
    }

    let userMessage = { role: "user", content: prompt };

    openAI
        .createChatCompletion([systemMessage, userMessage], false, null)
        .then((response) => response.json())
        .then((json) => {
            console.log(json);
            assistantMessage.value.role = json.choices[0].message.role;
            assistantMessage.value.content = json.choices[0].message.content;
        })
        .catch((error) => {
            console.error(error);
        })
        .finally(() => {
            logger.log("Game generated successfully!");
            generating.value = false;
            generationDone.value = true;
        });

    // Wait for Vue to update the DOM and make the new message element available, before continuing
    await nextTick();
};

watch(gameDescription, (newVal) => {
    if (gameDescription.value == "") {
        return;
    }

    generateGame(gameDescription.value);
    gameDescription.value = "";
});

const generatingMessage = ref("Generating game...");
const greetingMessage = ref(`
    Welcome to Gaimer, your very own game generator assistant!
    Describe your idea of a game as detailed as possible, click generate,
    then sit back and relax while the assistant gets your game ready to play!
`);
</script>

<template>
    <q-layout view="lHh Lpr lfF">
        <q-page-container>
            <q-page class="" id="page">
                <div v-if="apiKey == ''">
                    <Settings />
                </div>

                <div v-else>
                    <div v-if="generating">
                        {{ generatingMessage }}
                    </div>
                    <div v-else-if="generationDone">
                        <GameContainer
                            :game-content="assistantMessage.content"
                        />
                    </div>
                    <div v-else>
                        {{ greetingMessage }}
                    </div>
                </div>
            </q-page>
        </q-page-container>
        <q-footer>
            <UserInput />
        </q-footer>
    </q-layout>
</template>

<style scoped>
.logo.vite:hover {
    filter: drop-shadow(0 0 2em #747bff);
}

.logo.vue:hover {
    filter: drop-shadow(0 0 2em #249b73);
}

:root {
    font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 24px;
    font-weight: 400;

    color: #0f0f0f;
    background-color: #f6f6f6;

    font-synthesis: none;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    -webkit-text-size-adjust: 100%;
}

.container {
    margin: 0;
    padding-top: 10vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-align: center;
}

.logo {
    height: 6em;
    padding: 1.5em;
    will-change: filter;
    transition: 0.75s;
}

.logo.tauri:hover {
    filter: drop-shadow(0 0 2em #24c8db);
}

.row {
    display: flex;
    justify-content: center;
}

a {
    font-weight: 500;
    color: #646cff;
    text-decoration: inherit;
}

a:hover {
    color: #535bf2;
}

h1 {
    text-align: center;
}

input,
button {
    border-radius: 8px;
    border: 1px solid transparent;
    padding: 0.6em 1.2em;
    font-size: 1em;
    font-weight: 500;
    font-family: inherit;
    color: #0f0f0f;
    background-color: #ffffff;
    transition: border-color 0.25s;
    box-shadow: 0 2px 2px rgba(0, 0, 0, 0.2);
}

button {
    cursor: pointer;
}

button:hover {
    border-color: #396cd8;
}
button:active {
    border-color: #396cd8;
    background-color: #e8e8e8;
}

input,
button {
    outline: none;
}

#greet-input {
    margin-right: 5px;
}

@media (prefers-color-scheme: dark) {
    :root {
        color: #f6f6f6;
        background-color: #2f2f2f;
    }

    a:hover {
        color: #24c8db;
    }

    input,
    button {
        color: #ffffff;
        background-color: #0f0f0f98;
    }
    button:active {
        background-color: #0f0f0f69;
    }
}
</style>
