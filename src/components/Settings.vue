<script setup>
import { ref, watch } from "vue";
import { usePersistedStore } from "../stores/persisted-store.js";
import { storeToRefs } from "pinia";
import ConnectClaude from "./ConnectClaude.vue";

const persistedStore = usePersistedStore();
const { apiKey, selectedProvider } = storeToRefs(persistedStore);

const userInput = ref(apiKey.value);
const providerChoice = ref(selectedProvider.value || "openai");

const emit = defineEmits(["providerChanged"]);

watch(
    () => apiKey.value,
    (val) => {
        userInput.value = val;
    }
);

async function handleSaveApiKey() {
    userInput.value = userInput.value.replace(/^\s+|\s+$/g, "");
    if (userInput.value === "") return;
    apiKey.value = userInput.value;
}

function selectProvider(id) {
    providerChoice.value = id;
    selectedProvider.value = id;
    emit("providerChanged", id);
}

function onClaudeConnected() {
    emit("providerChanged", "anthropic");
}

function onClaudeDisconnected() {
    emit("providerChanged", "anthropic");
}

const model = defineModel({ default: false });

function closeDialog() {
    model.value = false;
}
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
            </q-card-section>

            <!-- Anthropic Claude settings -->
            <q-card-section v-if="providerChoice === 'anthropic'" class="q-pt-md">
                <ConnectClaude
                    @connected="onClaudeConnected"
                    @disconnected="onClaudeDisconnected"
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
