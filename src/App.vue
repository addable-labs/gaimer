<script setup>
import { nextTick, onMounted, ref, watch } from "vue";
import { useAppStore } from "./stores/app-store.js";
import { usePersistedStore } from "./stores/persisted-store.js";
import { useProviderStore } from "./stores/provider-store.js";
import { storeToRefs } from "pinia";
import { createProviderRegistry } from "./providers/registry.js";
import { createOpenAIProvider } from "./providers/openai-provider.js";
import { createAnthropicProvider } from "./providers/anthropic-provider.js";
import IndexedDBClient from "./helpers/indexeddb.js";
import UserInput from "./components/UserInput.vue";
import Settings from "./components/Settings.vue";
import GameList from "./components/GameList.vue";
import GameContainer from "./components/GameContainer.vue";
import { getSystemMessage } from "./helpers/prompts.js";
import Login from "./components/Login.vue";

const appStore = useAppStore();
const persistedStore = usePersistedStore();
const providerStore = useProviderStore();
const { gameDescription, loadedGame, gameList, generating } = storeToRefs(appStore);
const { apiKey, selectedProvider, userName, userAvatar } = storeToRefs(persistedStore);

// Set up provider registry with both providers
const registry = createProviderRegistry();
const openaiProvider = createOpenAIProvider();
const anthropicProvider = createAnthropicProvider();
registry.register(openaiProvider);
registry.register(anthropicProvider);

// Connect the selected provider
async function connectActiveProvider() {
    const id = selectedProvider.value;

    if (id === "openai" && apiKey.value) {
        const result = await openaiProvider.connect({ apiKey: apiKey.value });
        if (result.success) {
            registry.setActive("openai");
            providerStore.setActiveProvider("openai");
            providerStore.addConnection("openai", { connected: true, authMethod: "apikey" });
        }
    } else if (id === "anthropic") {
        const result = await anthropicProvider.connect();
        if (result.success) {
            registry.setActive("anthropic");
            providerStore.setActiveProvider("anthropic");
            providerStore.addConnection("anthropic", { connected: true, authMethod: "subscription" });
        } else {
            console.warn("Anthropic connect:", result.error);
            providerStore.removeConnection("anthropic");
        }
    }
}

// Re-connect when API key changes (OpenAI)
watch(apiKey, async () => {
    if (selectedProvider.value !== "openai") return;
    if (openaiProvider.isConnected()) {
        await openaiProvider.disconnect();
        providerStore.removeConnection("openai");
    }
    await connectActiveProvider();
});

// Handle provider switching or connection events from Settings/ConnectClaude
async function onProviderChanged(id) {
    // Disconnect previous provider if switching away
    const prev = registry.getActive();
    if (prev && prev.id !== id) {
        await prev.disconnect();
        providerStore.removeConnection(prev.id);
    }

    // Always run the full connect flow to ensure both the provider object
    // and the registry are properly wired up
    await connectActiveProvider();
}

const idbClient = IndexedDBClient();

const drawer = ref(false);
const showSettings = ref(false);
const showLogin = ref(false);

let game = ref({ id: "", prompts: [] });

// Generate a new game using the active provider
const generateGame = async (prompt) => {
    const provider = registry.getActive();
    if (!provider) {
        state.value = "error";
        debugMessage.value = "No AI provider connected. Open Settings to connect.";
        return;
    }

    state.value = "generating";
    generating.value = true;

    try {
        const isAnthropic = provider.id === "anthropic";
        const generator = provider.generateGame(prompt, {
            systemMessage: getSystemMessage(),
            model: isAnthropic ? "claude-sonnet-4-6" : "gpt-4o",
            maxTokens: 16384,
            temperature: 0.2,
        });

        let jsonResponse = null;
        for await (const chunk of generator) {
            if (chunk.type === "complete") {
                jsonResponse = chunk.data;
            }
        }

        if (!jsonResponse) {
            throw new Error("No response from AI provider");
        }

        let timestamp = Date.now().toString();
        let newGame = {
            id: timestamp,
            prompt: JSON.stringify(prompt),
            content: JSON.stringify(jsonResponse),
        };

        await idbClient.addItem(newGame);

        game.value = jsonResponse;
        loadedGame.value = timestamp;
        gameList.value.push({
            id: timestamp,
            title: jsonResponse.title,
            description: jsonResponse.description,
            controls: jsonResponse.controls,
            rules: jsonResponse.rules,
        });
        state.value = "done";
        console.log("Game generated");
    } catch (error) {
        console.error("Failed to generate game:", error);
        state.value = "error";
        debugMessage.value = error.message || String(error);
    } finally {
        generating.value = false;
    }

    await nextTick();
};

// Load selected game from IndexedDB
const loadGame = async (id) => {
    state.value = "loading";
    loadedGame.value = id;
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
        style: "",
        duration: 0,
    },
    error: { message: "", style: "", duration: 0 },
});

// Make sure to initiate the IndexedDB object store
onMounted(async () => {
    try {
        idbClient.initDB().then(() => console.log("[app] IndexedDB initialized"));
        await persistedStore.init();
        await connectActiveProvider();
    } catch (err) {
        console.warn("Startup error (non-fatal):", err);
    }
    // Show settings if no provider is connected
    if (!registry.getActive()) {
        showSettings.value = true;
    }
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
        <q-header class="safe-area-header">
            <q-toolbar class="bg-grey-10">
                <q-btn
                    flat
                    dense
                    round
                    icon="mdi-menu"
                    aria-label="Menu"
                    @click="drawer = !drawer"
                />
                <q-toolbar-title v-if="state === 'done'" class="text-subtitle2 ellipsis">
                    {{ game.title }}
                </q-toolbar-title>
            </q-toolbar>
        </q-header>
        <q-drawer
            v-model="drawer"
            bordered
            overlay
            @click.stop="drawer = false"
        >
            <GameList @loadGame="loadGame" />

            <q-item v-ripple class="fixed-bottom q-pa-md">
                <q-item-section side>
                    <q-avatar v-if="userAvatar" rounded size="48px">
                        <img :src="userAvatar" />
                    </q-avatar>
                    <q-btn
                        v-else
                        flat
                        color="primary"
                        dense
                        icon="mdi-login"
                        label="Login"
                        @click.stop="showLogin = true"
                    />
                </q-item-section>
                <q-item-section>
                    <q-item-label>{{ userName }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                    <q-btn
                        flat
                        dense
                        round
                        icon="mdi-cog"
                        aria-label="Settings"
                        @click="showSettings = true"
                    />
                </q-item-section>
            </q-item>
        </q-drawer>

        <q-page-container>
            <q-page id="page" class="game-page">
                <Settings v-model="showSettings" @providerChanged="onProviderChanged" />
                <Login v-model="showLogin" />

                <div v-if="state !== 'done'" class="status-container">
                    <div class="text-center q-pa-md">
                        {{ gameStates[state].message }}
                        {{ state === 'error' ? debugMessage : '' }}

                        <q-spinner-gears
                            v-if="state === 'generating' || state === 'loading'"
                            class="q-pa-lg"
                            color="primary"
                            size="8em"
                        />
                    </div>
                </div>

                <GameContainer
                    v-if="state === 'done'"
                    :game="game"
                    class="game-container-full"
                />
            </q-page>
        </q-page-container>
        <q-footer class="bg-grey-10 safe-area-footer">
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

/* iOS safe area support */
.safe-area-header {
    padding-top: var(--safe-area-top);
}
.safe-area-footer {
    padding-bottom: var(--safe-area-bottom);
}

/* Game page fills available space */
.game-page {
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.status-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
}

.game-container-full {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

/* Prevent iOS rubber-banding on the game area */
.game-container-full iframe {
    touch-action: none;
    -webkit-overflow-scrolling: auto;
}
</style>
