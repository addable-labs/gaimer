<script setup>
import { nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useAppStore } from "./stores/app-store.js";
import { usePersistedStore } from "./stores/persisted-store.js";
import { storeToRefs } from "pinia";
import { createProviderRegistry } from "./providers/registry.js";
import { createOpenAIProvider } from "./providers/openai-provider.js";
import { createAnthropicProvider } from "./providers/anthropic-provider.js";
import { initStorage, saveGame, loadGame as loadGameFromFS, listGames } from "./helpers/game-storage.js";
import UserInput from "./components/UserInput.vue";
import Settings from "./components/Settings.vue";
import GameList from "./components/GameList.vue";
import GameContainer from "./components/GameContainer.vue";
import { getSystemMessage } from "./helpers/prompts.js";
import { safeParseGameJSON } from "./helpers/json-utils.js";

const appStore = useAppStore();
const persistedStore = usePersistedStore();
const { gameDescription, loadedGame, gameList, generating } = storeToRefs(appStore);
const { apiKey, selectedProvider, selectedModels } = storeToRefs(persistedStore);

// Set up provider registry with both providers
const registry = createProviderRegistry();
const openaiProvider = createOpenAIProvider();
const anthropicProvider = createAnthropicProvider();
registry.register(openaiProvider);
registry.register(anthropicProvider);

// Counts connects and disconnects. Claude's sign-in check takes a while,
// and meanwhile the user can pick another provider or press Disconnect.
// When a connect ends after a newer connect or a disconnect has started,
// its result is out of date and is ignored.
let connectionChanges = 0;

// Connect the selected provider. A provider that fails to connect is no
// longer active, so generating asks the user to open Settings. (OpenAI's
// connect fails only without an API key, which is checked first.)
async function connectActiveProvider() {
    const change = ++connectionChanges;
    const id = selectedProvider.value;

    if (id === "openai" && apiKey.value) {
        const result = await openaiProvider.connect({ apiKey: apiKey.value });
        if (change !== connectionChanges) return;
        if (result.success) {
            registry.setActive("openai");
        }
    } else if (id === "anthropic") {
        const result = await anthropicProvider.connect();
        if (change !== connectionChanges) return;
        if (result.success) {
            registry.setActive("anthropic");
        } else {
            console.warn("Anthropic connect:", result.error);
            registry.deactivate("anthropic");
        }
    }
}

// Disconnect a provider. It is then no longer active, so until another
// provider connects, generating asks the user to open Settings.
async function disconnectProvider(provider) {
    connectionChanges++;
    await provider.disconnect();
    registry.deactivate(provider.id);
}

// Re-connect when API key changes (OpenAI)
watch(apiKey, async () => {
    if (selectedProvider.value !== "openai") return;
    if (openaiProvider.isConnected()) {
        await disconnectProvider(openaiProvider);
    }
    await connectActiveProvider();
});

// Handle provider switching or connection events from Settings/ConnectClaude
async function onProviderChanged(id) {
    // Disconnect previous provider if switching away
    const prev = registry.getActive();
    if (prev && prev.id !== id) {
        await disconnectProvider(prev);
    }

    // Always run the full connect flow to ensure both the provider object
    // and the registry are properly wired up
    await connectActiveProvider();
}

// Handle the Disconnect button in Settings
async function onProviderDisconnected(id) {
    await disconnectProvider(registry.get(id));
}


const drawer = ref(false);
const showSettings = ref(false);

let game = ref({ id: "", prompts: [] });
const lastPrompt = ref("");
const elapsedSeconds = ref(0);
let elapsedTimer = null;

function startElapsedTimer() {
    elapsedSeconds.value = 0;
    elapsedTimer = setInterval(() => { elapsedSeconds.value++; }, 1000);
}

function stopElapsedTimer() {
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
}

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
    lastPrompt.value = prompt;
    startElapsedTimer();

    try {
        // With no model chosen, the provider uses its default
        const generator = provider.generateGame(prompt, {
            systemMessage: getSystemMessage(),
            model: selectedModels.value[provider.id],
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

        await saveGame(newGame);

        game.value = jsonResponse;
        loadedGame.value = timestamp;
        // The list shows the newest game first
        gameList.value.unshift({
            id: timestamp,
            title: jsonResponse.title,
            description: jsonResponse.description,
            controls: jsonResponse.controls,
            rules: jsonResponse.rules,
        });
        state.value = "done";
    } catch (error) {
        console.error("Failed to generate game:", error);
        state.value = "error";
        debugMessage.value = error.message || String(error);
    } finally {
        generating.value = false;
        stopElapsedTimer();
    }

    await nextTick();
};

// Load selected game from filesystem and show it. While the file is being
// read, the user can open another game or delete this one; then neither this
// game nor an error reading it is shown.
const loadGame = async (id) => {
    state.value = "loading";
    loadedGame.value = id;
    try {
        const item = await loadGameFromFS(id);
        if (loadedGame.value !== id) return;
        const result = safeParseGameJSON(item.content);
        if (!result.ok) throw new Error(result.error);
        game.value = result.data;
        state.value = "done";
    } catch (error) {
        if (loadedGame.value !== id) return;
        console.error("Failed to load game:", id, error);
        state.value = "error";
        debugMessage.value = error.message || String(error);
    }
};

// When the user deletes the open game, take it off the screen, since its
// progress can no longer be saved. If the game is still being read, leave
// "Loading game...": loadGame will not show it. A new game being generated
// stays.
function onGameDeleted(id) {
    if (loadedGame.value !== id) return;
    loadedGame.value = null;
    if (state.value === "done" || state.value === "loading") state.value = "idle";
}

const debugMessage = ref("no problems here!");
const greetingMessage = `
    Welcome to Gaimer, your very own game generator assistant!
    Describe your idea of a game as detailed as possible, click the send button,
    then sit back and relax while the assistant generates your game ready to play!
`;

const state = ref("idle");
const gameStates = ref({
    idle: { message: greetingMessage },
    loading: { message: "Loading game..." },
});

onBeforeUnmount(() => { stopElapsedTimer(); });

onMounted(async () => {
    try {
        await initStorage();
        // Load game list after storage is ready
        if (gameList.value.length === 0) {
            gameList.value = await listGames();
        }
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
            <GameList @loadGame="loadGame" @gameDeleted="onGameDeleted" />

            <q-item v-ripple class="fixed-bottom q-pa-md">
                <q-item-section>
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
                <Settings v-model="showSettings" :registry="registry" @providerChanged="onProviderChanged" @providerDisconnected="onProviderDisconnected" />

                <div v-if="state !== 'done'" class="status-container">
                    <div class="text-center q-pa-md">
                        <!-- Idle / Loading -->
                        <template v-if="state === 'idle' || state === 'loading'">
                            {{ gameStates[state].message }}
                        </template>

                        <!-- Generating with timer -->
                        <template v-if="state === 'generating'">
                            <div class="text-body1 q-mb-sm">Generating game... ({{ elapsedSeconds }}s)</div>
                        </template>

                        <q-spinner-gears
                            v-if="state === 'generating' || state === 'loading'"
                            class="q-pa-lg"
                            color="primary"
                            size="8em"
                        />

                        <!-- Error with retry -->
                        <template v-if="state === 'error'">
                            <q-banner rounded class="bg-grey-9 text-white q-mb-md">
                                <template v-slot:avatar>
                                    <q-icon name="mdi-alert-circle" color="negative" />
                                </template>
                                {{ debugMessage }}
                            </q-banner>
                            <q-btn
                                v-if="lastPrompt"
                                outline
                                no-caps
                                color="grey-5"
                                label="Retry"
                                icon="mdi-refresh"
                                @click="generateGame(lastPrompt)"
                            />
                        </template>
                    </div>
                </div>

                <!-- Each game gets a GameContainer of its own, which loads the game when mounted -->
                <GameContainer
                    v-if="state === 'done'"
                    :key="loadedGame"
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
