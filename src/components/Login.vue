<script setup>
import { ref, onMounted } from "vue";
import { usePersistedStore } from "../stores/persisted-store.js";
import { storeToRefs } from "pinia";
import * as firebase from "firebase/app";
import "firebase/auth";
import * as firebaseui from "firebaseui";
import "firebaseui/dist/firebaseui.css";

const persistedStore = usePersistedStore();
const { apiKey } = storeToRefs(persistedStore);

const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_FIREBASE_AUTH_DOMAIN",
  projectId: "YOUR_FIREBASE_PROJECT_ID",
  storageBucket: "YOUR_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "YOUR_FIREBASE_MESSAGING_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID",
};

firebase.initializeApp(firebaseConfig);

const uiConfig = {
  signInSuccessUrl: "/",
  signInOptions: [
    firebase.auth.GoogleAuthProvider.PROVIDER_ID,
    firebase.auth.EmailAuthProvider.PROVIDER_ID,
  ],
  tosUrl: "/terms-of-service",
  privacyPolicyUrl: "/privacy-policy",
};

const ui = new firebaseui.auth.AuthUI(firebase.auth());

const user = ref(null);

onMounted(() => {
  firebase.auth().onAuthStateChanged((user) => {
    if (user) {
      apiKey.value = user.uid;
      localStorage.setItem("fb_apiKey", user.uid);
      localStorage.setItem("fb_userName", user.displayName);
      localStorage.setItem("fb_userAvatar", user.photoURL);
    } else {
      ui.start("#firebaseui-auth-container", uiConfig);
    }
  });
});
</script>

<template>
  <div id="firebaseui-auth-container"></div>
</template>
