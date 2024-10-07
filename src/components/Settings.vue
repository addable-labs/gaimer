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
}

const props = defineProps({
    modelValue: {
        type: Boolean,
        default: false,
    },
});

const emit = defineEmits(["update:modelValue"]);

function closeDialog() {
    emit("update:modelValue", false);
}
</script>

<template>
    <q-dialog v-model="modelValue">
        <q-card>
            <q-card-section>
                <div class="text-h6">Settings</div>
            </q-card-section>

            <q-card-section class="q-pt-none">
                <q-input
                    dense
                    filled
                    autofocus
                    id="user-input"
                    v-model="userInput"
                    label="Enter your API key..."
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
