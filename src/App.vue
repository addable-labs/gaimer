<script setup>
import { nextTick, ref, watch } from "vue";
import { useQuasar } from "quasar";
import { useAppStore } from "./stores/app-store.js";
import { storeToRefs } from "pinia";
import logger from "./helpers/logger.js";
import OpenAI from "./helpers/openai.js";
import UserInput from "./components/UserInput.vue";
import Settings from "./components/Settings.vue";
import GameContainer from "./components/GameContainer.vue";

const $q = useQuasar();
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

            Important: Set screen width to ${$q.screen.width * 0.8}px and height to 80% of ${$q.screen.height * 0.8}px.

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
    Describe your idea of a game as detailed as possible, click the send button,
    then sit back and relax while the assistant generates your game ready to play!
`);
</script>

<template>
    <q-layout view="lHh Lpr lfF" class="JetBrainsMono-font text-primary">
        <q-page-container>
            <q-page id="page">
                <q-card
                    flat
                    class="absolute-center q-pa-lg JetBrainsMono-font text-primary"
                >
                    <div v-if="apiKey == ''">
                        <Settings />
                    </div>

                    <div v-else>
                        <div v-if="generating">
                            {{ generatingMessage }}
                            <p />
                            <q-spinner-gears color="primary" size="8em" />
                        </div>
                        <div v-else-if="generationDone">
                            <GameContainer
                                class="center"
                                :game-content="assistantMessage.content"
                            />
                        </div>
                        <div v-else>
                            {{ greetingMessage }}
                        </div>
                    </div>
                </q-card>
            </q-page>
        </q-page-container>
        <q-footer :class="$q.dark.isActive ? 'bg-grey-10' : 'bg-grey-4'">
            <UserInput />
        </q-footer>
    </q-layout>
</template>

<style>
/* Hide scrollbars on Macs (and WebKit based webviews)  */
::-webkit-scrollbar {
    display: none;
}
/* Hide scrollbars on Windows (in IE and Edge) */
body {
    overflow: auto;
    -ms-overflow-style: none;
}
/* Hide scrollbars in Firefox */
html {
    scrollbar-width: none;
}
</style>
