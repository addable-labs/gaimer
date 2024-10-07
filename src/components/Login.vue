<script setup>
import { ref, onMounted } from "vue";
import { usePersistedStore } from "../stores/persisted-store.js";
import { storeToRefs } from "pinia";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const model = defineModel({ default: false });

const persistedStore = usePersistedStore();
const { user } = storeToRefs(persistedStore);

const FIREBASE_WEB_API_KEY = "";
const FIREBASE_AUTH_DOMAIN = "";
const FIREBASE_PROJECT_ID = "";
const FIREBASE_STORAGE_BUCKET = "";
const FIREBASE_MESSAGING_SENDER_ID = "";
const FIREBASE_APP_ID = "";

const firebaseConfig = {
    apiKey: "FIREBASE_WEB_API_KEY",
    authDomain: "FIREBASE_AUTH_DOMAIN",
    projectId: "FIREBASE_PROJECT_ID",
    storageBucket: "FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
    appId: "FIREBASE_APP_ID",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const email = ref(null);
const password = ref(null);

const handleLogin = () => {
    if (FIREBASE_WEB_API_KEY == "") return;
    signInWithEmailAndPassword(auth, email.value, password.value)
        .then((userCredential) => {
            // Signed in
            user.value = userCredential.user;
            // ...
        })
        .catch((error) => {
            const errorCode = error.code;
            const errorMessage = error.message;
        });
};

onMounted(() => {
    handleLogin();
});
</script>

<template>
    <q-dialog v-model="model">
        <q-card style="width: 350px; max-width: 75vw">
            <q-card-section>
                <div class="text-h6">Login</div>
                <div class="text-caption">
                    You need to authenticate to use this service
                </div>
            </q-card-section>
            <q-card-section>
                <q-input v-model="email" label="Email" autofocus dense filled />
                <q-input
                    v-model="password"
                    label="Password"
                    dense
                    filled
                    class="q-pt-md"
                />
            </q-card-section>
            <q-card-actions align="right">
                <q-btn label="Cancel" flat @click="model = false" />
                <q-btn
                    label="Login"
                    flat
                    color="primary"
                    @click="handleLogin()"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>
