<script setup>
import { ref, watch } from "vue";
import { usePersistedStore } from "../stores/persisted-store.js";
import { storeToRefs } from "pinia";
import ConnectClaude from "./ConnectClaude.vue";
import { CLAUDE_EFFORTS, DEFAULT_CLAUDE_EFFORT, hasEffortLevels, usualWait } from "../providers/claude-effort.js";

const props = defineProps({
    registry: { type: Object, required: true },
    // Checks Claude's sign-in and connects Claude, for the Claude panel
    connectClaude: { type: Function, required: true },
});

const persistedStore = usePersistedStore();
const { apiKey, apiKeyError, selectedProvider, selectedModels, claudeEffort } = storeToRefs(persistedStore);

const userInput = ref(apiKey.value);
const providerChoice = ref(selectedProvider.value || "openai");
// The models each provider offers, kept apart: a provider's list can
// arrive after the user has picked the other provider
const availableModels = ref({ openai: [], anthropic: [] });
const loadingModels = ref({ openai: false, anthropic: false });

const emit = defineEmits(["providerChanged", "providerDisconnected"]);

watch(
    () => apiKey.value,
    (val) => {
        userInput.value = val;
    }
);

async function fetchModels(providerId) {
    const provider = props.registry.get(providerId);
    if (!provider || !provider.listModels) {
        availableModels.value[providerId] = [];
        return;
    }
    loadingModels.value[providerId] = true;
    try {
        availableModels.value[providerId] = await provider.listModels();
    } catch {
        availableModels.value[providerId] = [];
    }
    loadingModels.value[providerId] = false;
}

// What a provider's Model select shows while no model is chosen: the model
// the provider then uses. It is not saved as a choice, so a later change of
// the provider's default applies.
function defaultModelLabel(providerId) {
    if (selectedModels.value[providerId]) return undefined;
    const defaultModel = props.registry.get(providerId)?.defaultModel;
    return defaultModel ? `${defaultModel} (default)` : undefined;
}

// The names of Claude's effort levels in the Effort select
const effortNames = { low: "Low", medium: "Medium", high: "High" };

// The Claude model a game is generated with: the one chosen, or else the
// provider's default
function claudeModel() {
    return selectedModels.value.anthropic || props.registry.get("anthropic")?.defaultModel;
}

// An effort level as the Effort select shows it, with how long a game
// usually takes at it, when that was timed for the model
function effortLabel(effort, name = effortNames[effort]) {
    const wait = usualWait(claudeModel(), effort);
    return wait ? `${name} · ${wait}` : name;
}

function effortOptions() {
    return CLAUDE_EFFORTS.map((effort) => ({ label: effortLabel(effort), value: effort }));
}

// What the Effort select shows while no level is chosen: the level Claude
// then runs at. It is not saved as a choice, so a later change of the
// default applies.
function defaultEffortLabel() {
    if (claudeEffort.value) return undefined;
    return effortLabel(DEFAULT_CLAUDE_EFFORT, `${effortNames[DEFAULT_CLAUDE_EFFORT]} (default)`);
}

async function handleSaveApiKey() {
    userInput.value = userInput.value.replace(/^\s+|\s+$/g, "");
    if (userInput.value === "") return;
    apiKey.value = userInput.value;
}

function selectProvider(id) {
    providerChoice.value = id;
    selectedProvider.value = id;
    emit("providerChanged", id);
    fetchModels(id);
}

// The panel's sign-in check has connected Claude already
function onClaudeConnected() {
    fetchModels("anthropic");
}

function onClaudeDisconnected() {
    emit("providerDisconnected", "anthropic");
    availableModels.value.anthropic = [];
}

const model = defineModel({ default: false });

function closeDialog() {
    model.value = false;
}

// Fetch models for the current provider on mount
watch(model, (visible) => {
    if (visible) fetchModels(providerChoice.value);
});
</script>

<template>
    <q-dialog v-model="model">
        <q-card style="width: 420px; max-width: 92vw">
            <q-card-section>
                <div class="text-h6">Settings</div>
            </q-card-section>

            <q-card-section class="q-pt-none">
                <div class="text-subtitle2 q-mb-sm">AI Provider</div>
                <q-btn-toggle
                    v-model="providerChoice"
                    spread
                    no-caps
                    rounded
                    toggle-color="grey-7"
                    color="grey-9"
                    text-color="grey-5"
                    toggle-text-color="white"
                    :options="[
                        { label: 'OpenAI', value: 'openai', icon: 'mdi-creation' },
                        { label: 'Claude', value: 'anthropic', icon: 'mdi-robot' },
                    ]"
                    @update:model-value="selectProvider"
                />
            </q-card-section>

            <q-separator />

            <!-- OpenAI settings -->
            <q-card-section v-if="providerChoice === 'openai'" class="q-pt-md">
                <div class="text-body2 text-grey-5 q-mb-sm">
                    Requires an OpenAI API key.
                </div>
                <q-input
                    dense
                    filled
                    id="settings-api-key"
                    v-model="userInput"
                    label="API key"
                    type="password"
                    :error="!!apiKeyError"
                    :error-message="apiKeyError"
                    @keydown.enter="handleSaveApiKey()"
                >
                    <template v-slot:append>
                        <q-btn
                            flat
                            dense
                            round
                            icon="mdi-content-save"
                            color="primary"
                            @click="handleSaveApiKey()"
                            :disable="!userInput"
                        >
                            <q-tooltip>Save</q-tooltip>
                        </q-btn>
                    </template>
                </q-input>
                <q-select
                    dense
                    filled
                    v-model="selectedModels.openai"
                    :options="availableModels.openai"
                    :loading="loadingModels.openai"
                    :display-value="defaultModelLabel('openai')"
                    label="Model"
                    class="q-mt-md"
                    emit-value
                    map-options
                />
            </q-card-section>

            <!-- Anthropic Claude settings -->
            <q-card-section v-if="providerChoice === 'anthropic'" class="q-pt-md">
                <ConnectClaude
                    :connect="connectClaude"
                    @connected="onClaudeConnected"
                    @disconnected="onClaudeDisconnected"
                />
                <q-select
                    dense
                    filled
                    v-model="selectedModels.anthropic"
                    :options="availableModels.anthropic"
                    :loading="loadingModels.anthropic"
                    :display-value="defaultModelLabel('anthropic')"
                    label="Model"
                    class="q-mt-md"
                    emit-value
                    map-options
                />
                <q-select
                    dense
                    filled
                    v-model="claudeEffort"
                    :options="effortOptions()"
                    :display-value="defaultEffortLabel()"
                    :disable="!hasEffortLevels(claudeModel())"
                    :hint="hasEffortLevels(claudeModel()) ? undefined : 'haiku has no effort levels'"
                    label="Effort"
                    class="q-mt-md"
                    emit-value
                    map-options
                />
            </q-card-section>

            <q-card-actions align="right">
                <q-btn
                    flat
                    no-caps
                    label="Close"
                    color="grey-5"
                    @click="closeDialog"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>
