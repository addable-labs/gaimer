<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useQuasar } from "quasar";
import { useAppStore } from "./stores/app-store.js";
import { usePersistedStore } from "./stores/persisted-store.js";
import { storeToRefs } from "pinia";
import logger from "./helpers/logger.js";
import OpenAIClient from "./helpers/openai.js";
import UserInput from "./components/UserInput.vue";
import Settings from "./components/Settings.vue";
import GameContainer from "./components/GameContainer.vue";
import { getSystemMessage } from "./helpers/prompts.js";
import { initDB, saveGame, listGames, loadGame, deleteGame } from "./helpers/indexeddb.js";
import GameList from "./components/GameList.vue";

const $q = useQuasar();
const appStore = useAppStore();
const persistedStore = usePersistedStore();
const { gameDescription, generating } = storeToRefs(appStore);
const { apiKey } = storeToRefs(persistedStore);

const openAI = OpenAIClient(apiKey.value);
const assistantMessage = ref({ role: "assistant", content: "" });

const generationDone = ref(false);

const gameContainerSize = ref({
    width: document.documentElement.clientWidth - 50,
    height: document.documentElement.clientHeight - 100,
});

const onResize = () => {
    gameContainerSize.value = {
        width: document.documentElement.clientWidth - 50,
        height: document.documentElement.clientHeight - 100,
    };
};

const generateGame = async (prompt) => {
    generating.value = true;
    generationDone.value = false;
    let systemMessage = {
        role: "system",
        content: getSystemMessage(gameContainerSize),
    };

    if (prompt == "") {
        prompt =
            "Create a simple pong game with two paddles and a bouncing ball.";
    }

    let userMessage = { role: "user", content: prompt };

    openAI
        .createChatCompletion([systemMessage, userMessage])
        .then((response) => {
            console.log(response.choices[0].message.content);
            assistantMessage.value.role = response.choices[0].message.role;
            assistantMessage.value.content = JSON.parse(
                response.choices[0].message.content,
            ).code;

            // Save the game to IndexedDB
            saveGame({
                prompt: prompt,
                response: assistantMessage.value.content,
            });
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

const listAllGames = async () => {
    try {
        const games = await listGames();
        console.log(games);
    } catch (error) {
        console.error("Failed to list games:", error);
    }
};

const loadSelectedGame = async (id) => {
    try {
        const game = await loadGame(id);
        console.log(game);
    } catch (error) {
        console.error("Failed to load game:", error);
    }
};

const deleteSelectedGame = async (id) => {
    try {
        await deleteGame(id);
        console.log("Game deleted successfully");
    } catch (error) {
        console.error("Failed to delete game:", error);
    }
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
                <q-resize-observer @resize="onResize" />
                <div v-if="apiKey == ''">
                    <Settings />
                </div>

                <div v-else>
                    <q-card
                        v-if="generating"
                        bordered
                        flat
                        class="absolute-center text-center q-pa-lg JetBrainsMono-font text-primary"
                    >
                        {{ generatingMessage }}
                        <p />
                        <q-spinner-gears color="primary" size="8em" />
                    </q-card>

                    <q-card
                        v-else-if="generationDone"
                        bordered
                        flat
                        class="absolute-center text-center q-pa-lg JetBrainsMono-font text-primary"
                        style="
                            width: calc(100vw - 50px);
                            height: calc(100vh - 100px);
                        "
                    >
                        <GameContainer
                            :game-content="assistantMessage.content"
                        />
                    </q-card>

                    <q-card
                        v-else
                        bordered
                        flat
                        class="absolute-center text-center q-pa-lg JetBrainsMono-font text-primary text-body2 text-uppercase"
                    >
                        {{ greetingMessage }}
                    </q-card>
                </div>
            </q-page>
        </q-page-container>
        <q-footer :class="$q.dark.isActive ? 'bg-grey-10' : 'bg-grey-4'">
            <UserInput />
        </q-footer>
        <q-btn @click="listAllGames">List Games</q-btn>
        <GameList @loadGame="loadSelectedGame" @deleteGame="deleteSelectedGame" />
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
