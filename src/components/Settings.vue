<script setup>
import { ref, watch } from "vue";
import { usePersistedStore } from "../stores/persisted-store.js";
import { storeToRefs } from "pinia";
import ConnectClaude from "./ConnectClaude.vue";

const props = defineProps({
    registry: { type: Object, required: true },
});

const persistedStore = usePersistedStore();
const { apiKey, apiKeyError, selectedProvider, selectedModels } = storeToRefs(persistedStore);

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

function onClaudeConnected() {
    emit("providerChanged", "anthropic");
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
                    label="Model"
                    class="q-mt-md"
                    emit-value
                    map-options
                />
            </q-card-section>

            <!-- Anthropic Claude settings -->
            <q-card-section v-if="providerChoice === 'anthropic'" class="q-pt-md">
                <ConnectClaude
                    @connected="onClaudeConnected"
                    @disconnected="onClaudeDisconnected"
                />
                <q-select
                    dense
                    filled
                    v-model="selectedModels.anthropic"
                    :options="availableModels.anthropic"
                    :loading="loadingModels.anthropic"
                    label="Model"
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
