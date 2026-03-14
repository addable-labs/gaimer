<script setup>
import { ref } from "vue";
import { usePersistedStore } from "../stores/persisted-store.js";
import { storeToRefs } from "pinia";

const persistedStore = usePersistedStore();
const { apiKey } = storeToRefs(persistedStore);

const userInput = ref(apiKey.value);

async function handleInput() {
    // Trim user input of any whitespace characters
    userInput.value = userInput.value.replace(/^\s+|\s+$/g, "");

    if (userInput.value == "") {
        return;
    }

    apiKey.value = userInput.value;
    closeDialog();
}

const model = defineModel({ default: false });

function closeDialog() {
    model.value = false;
}
</script>

<template>
    <q-dialog v-model="model">
        <q-card style="width: 350px; max-width: 85vw">
            <q-card-section>
                <div class="text-h6">Settings</div>
            </q-card-section>

            <q-card-section class="q-pt-none">
                <q-input
                    dense
                    filled
                    autofocus
                    id="settings-api-key"
                    v-model="userInput"
                    label="OpenAI API key"
                    type="password"
                    @keydown.enter="handleInput()"
                />
            </q-card-section>

            <q-card-actions align="right">
                <q-btn
                    flat
                    label="Close"
                    color="primary"
                    @click="closeDialog"
                />
                <q-btn
                    flat
                    label="Save"
                    color="primary"
                    @click="handleInput()"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>
