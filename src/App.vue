<script setup>
import { nextTick, onMounted, ref, watch, watchEffect } from "vue";
import { useQuasar } from "quasar";
import { useAppStore } from "./stores/app-store.js";
import { usePersistedStore } from "./stores/persisted-store.js";
import { storeToRefs } from "pinia";
import logger from "./helpers/logger.js";
import OpenAIClient from "./helpers/openai.js";
import IndexedDBClient from "./helpers/indexeddb.js";
import UserInput from "./components/UserInput.vue";
import Settings from "./components/Settings.vue";
import GameContainer from "./components/GameContainer.vue";
import { getSystemMessage } from "./helpers/prompts.js";
import GameList from "./components/GameList.vue";

const $q = useQuasar();
const appStore = useAppStore();
const persistedStore = usePersistedStore();
const { gameDescription, generating } = storeToRefs(appStore);
const { apiKey } = storeToRefs(persistedStore);

const openAI = OpenAIClient(apiKey.value);
const idbClient = IndexedDBClient();

const drawer = ref(false);

let game = ref({ id: "", prompts: [] });
const gameContainerSize = ref({
    width: document.documentElement.clientWidth - 50,
    height: document.documentElement.clientHeight - 100,
});

const onResize = () => {
    gameContainerSize.value = {
        width: document.documentElement.clientWidth - 50,
        height: document.documentElement.clientHeight - 100,
    };
    console.log(gameContainerSize.value);
};

const generateGame = async (prompt) => {
    state.value = "generating";
    let systemMessage = {
        role: "system",
        content: getSystemMessage(gameContainerSize),
    };

    let userMessage = { role: "user", content: prompt };

    openAI
        .createChatCompletion([systemMessage, userMessage])
        .then((response) => {
            // console.log(response.choices[0].message.content);
            let jsonResponse = JSON.parse(response.choices[0].message.content);

            let timestamp = Date.now().toString();
            let newGame = {
                id: timestamp,
                prompt: JSON.stringify(prompt),
                content: JSON.stringify(jsonResponse),
            };

            // Save the game to IndexedDB
            idbClient
                .addItem(newGame)
                .then(() => {
                    game.value = jsonResponse;
                    state.value = "done";
                    console.log("Game generated");
                })
                .catch((error) => {
                    debugMessage.value = error;
                    console.error("Failed to save game:", error);
                });
        })
        .catch((error) => {
            console.error(error);
            state.value = "error";
            debugMessage.value = error;
        });
    // Wait for Vue to update the DOM and make the new message element available, before continuing
    await nextTick();
};

const loadGame = async (id) => {
    state.value = "loading";
    idbClient
        .getItem(id)
        .then((item) => {
            game.value = JSON.parse(item.content);
            setTimeout(() => {
                state.value = "done";
            }, gameStates.value.loading.duration);
        })
        .catch((error) => {
            console.error("Failed to load game:", id, error);
            state.value = "error";
            debugMessage.value = error;
        });
};

const debugMessage = ref("no problems here!");
const greetingMessage = `
    Welcome to Gaimer, your very own game generator assistant!
    Describe your idea of a game as detailed as possible, click the send button,
    then sit back and relax while the assistant generates your game ready to play!
`;

const state = ref("idle");
const gameStates = ref({
    idle: { message: greetingMessage, style: "", duration: 0 },
    generating: { message: "Generating game...", style: "", duration: 0 },
    loading: { message: "Loading game...", style: "", duration: 1000 },
    done: {
        message: "",
        style: "width: calc(95vw - 50px);height: calc(95vh - 150px);",
        duration: 0,
    },
    error: { message: "Failed to load game", style: "", duration: 0 },
});

// Make sure to initiate the IndexedDB object store
onMounted(() => {
    idbClient.initDB().then(() => console.log("[app] IndexedDB initialized"));
});

// Watch for new game descriptions from the user input
watch(gameDescription, (newVal) => {
    if (gameDescription.value == "") {
        return;
    }

    generateGame(gameDescription.value);
    gameDescription.value = "";
});

// Watch for changes in the game state
watch(state, (newVal, oldVal) => {
    console.log(`State changed: ${oldVal} -> ${newVal}`);
});

watch(game, (newVal) => {
    if (newVal) {
        console.log("Game loaded", game.value.title);
    }
});
</script>

<template>
    <q-layout view="hHh Lpr lfF" class="JetBrainsMono-font text-primary">
        <q-header>
            <q-toolbar class="bg-grey-10">
                <q-btn
                    flat
                    dense
                    round
                    icon="mdi-menu"
                    aria-label="Meny"
                    @click="drawer = !drawer"
                />
            </q-toolbar>
        </q-header>
        <q-drawer
            v-model="drawer"
            bordered
            overlay
            @click.stop="drawer = false"
        >
            <GameList @loadGame="loadGame" />
        </q-drawer>

        <q-page-container>
            <q-page id="page">
                <q-resize-observer @resize="onResize" />
                <div v-if="apiKey == ''">
                    <Settings />
                </div>

                <div v-else>
                    <q-card
                        bordered
                        flat
                        class="absolute-center text-center q-pa-sm JetBrainsMono-font text-primary"
                        :style="gameStates[state].style"
                    >
                        {{ gameStates[state].message }}

                        <q-spinner-gears
                            v-if="state == 'generating' || state == 'loading'"
                            class="q-pa-lg"
                            color="primary"
                            size="8em"
                        />
                        <GameContainer v-if="state == 'done'" :game="game" />
                    </q-card>
                </div>
            </q-page>
        </q-page-container>
        <q-footer class="bg-grey-10">
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
