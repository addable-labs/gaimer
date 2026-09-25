<script setup>
import { ref, onMounted } from "vue";
import { Command } from "@tauri-apps/plugin-shell";
import { openUrl } from "@tauri-apps/plugin-opener";
import { shellExec } from "../helpers/shell.js";

const emit = defineEmits(["connected", "disconnected"]);

// State machine: checking → not_installed | not_authenticated | authenticating | connected | error
const phase = ref("checking");
const errorMessage = ref("");
const cliVersion = ref("");

async function checkAvailability() {
    phase.value = "checking";
    errorMessage.value = "";

    // Step 1: Check if claude CLI is installed
    try {
        const version = await shellExec("claude --version", 10000);
        cliVersion.value = version.trim();
    } catch {
        phase.value = "not_installed";
        return;
    }

    // Step 2: Check if authenticated
    await checkAuth();
}

async function checkAuth() {
    try {
        const output = await shellExec("claude auth status", 10000);
        if (
            output.includes('"loggedIn": true') ||
            output.includes('"loggedIn":true') ||
            output.includes("Logged in")
        ) {
            phase.value = "connected";
            emit("connected");
        } else {
            phase.value = "not_authenticated";
        }
    } catch {
        phase.value = "not_authenticated";
    }
}

// Copy a command to the clipboard. The Copy buttons call this because a
// template cannot use globals such as navigator.
async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // Ignore clipboard errors
    }
}

async function startLogin() {
    phase.value = "authenticating";

    // Open Terminal on macOS. The capability allows open-app through
    // spawn() only
    try {
        await Command.create("open-app", ["-a", "Terminal"]).spawn();
    } catch {
        // Ignore — user can open terminal manually
    }

    // Copy the command to clipboard
    await copy("claude auth login");
}

async function retryAuth() {
    phase.value = "checking";
    await checkAuth();
    if (phase.value !== "connected") {
        phase.value = "not_authenticated";
    }
}

function disconnect() {
    phase.value = "not_authenticated";
    emit("disconnected");
}

onMounted(() => {
    checkAvailability();
});
</script>

<template>
    <div class="connect-claude">
        <!-- Checking -->
        <div v-if="phase === 'checking'" class="phase-content">
            <q-spinner-dots color="primary" size="2em" />
            <div class="q-mt-sm text-body2">Checking Claude CLI...</div>
        </div>

        <!-- Not installed -->
        <div v-else-if="phase === 'not_installed'" class="phase-content">
            <q-icon name="mdi-download" color="warning" size="2em" />
            <div class="q-mt-sm text-subtitle2">Claude CLI not found</div>
            <div class="text-body2 q-mt-xs text-grey-5">
                Install Claude Code to use your subscription:
            </div>

            <q-card flat bordered class="q-mt-md q-pa-sm bg-grey-9 cmd-card">
                <div class="row items-center no-wrap">
                    <code class="col text-grey-3" style="font-size: 0.85em">
                        npm install -g @anthropic-ai/claude-code
                    </code>
                    <q-btn
                        flat
                        dense
                        round
                        icon="mdi-content-copy"
                        size="sm"
                        color="grey-5"
                        @click="copy('npm install -g @anthropic-ai/claude-code')"
                    >
                        <q-tooltip>Copy</q-tooltip>
                    </q-btn>
                </div>
            </q-card>

            <div class="text-caption text-grey-6 q-mt-sm">
                Requires Node.js and a
                <a
                    href="#"
                    class="text-grey-4"
                    style="text-decoration: underline"
                    @click.prevent="openUrl('https://claude.ai/pricing')"
                >Claude Pro or Max</a>
                subscription.
            </div>

            <q-btn
                outline
                no-caps
                color="grey-5"
                label="Retry"
                icon="mdi-refresh"
                class="q-mt-md"
                @click="checkAvailability"
            />
        </div>

        <!-- Not authenticated -->
        <div v-else-if="phase === 'not_authenticated'" class="phase-content">
            <q-icon name="mdi-account-key" color="warning" size="2em" />
            <div class="q-mt-sm text-subtitle2">Sign in required</div>
            <div class="text-body2 q-mt-xs text-grey-5">
                Claude CLI is installed but not signed in.
            </div>

            <q-btn
                outline
                no-caps
                color="grey-4"
                label="Sign in to Claude"
                icon="mdi-login"
                class="q-mt-md full-width"
                @click="startLogin"
            />

            <div class="text-caption text-grey-6 q-mt-sm text-center">
                Or run in your terminal:
            </div>
            <q-card flat bordered class="q-mt-xs q-pa-sm bg-grey-9 cmd-card">
                <div class="row items-center no-wrap">
                    <code class="col text-grey-3" style="font-size: 0.85em">
                        claude auth login
                    </code>
                    <q-btn
                        flat
                        dense
                        round
                        icon="mdi-content-copy"
                        size="sm"
                        color="grey-5"
                        @click="copy('claude auth login')"
                    >
                        <q-tooltip>Copy</q-tooltip>
                    </q-btn>
                </div>
            </q-card>
        </div>

        <!-- Authenticating (waiting for user) -->
        <div v-else-if="phase === 'authenticating'" class="phase-content">
            <q-spinner-dots color="grey-4" size="2em" />
            <div class="q-mt-sm text-subtitle2">Waiting for sign-in...</div>
            <div class="text-body2 q-mt-xs text-grey-5">
                Complete sign-in in your terminal or browser, then click below.
            </div>

            <q-card flat bordered class="q-mt-md q-pa-sm bg-grey-9 cmd-card">
                <div class="row items-center no-wrap">
                    <code class="col text-grey-3" style="font-size: 0.85em">
                        claude auth login
                    </code>
                    <q-btn
                        flat
                        dense
                        round
                        icon="mdi-content-copy"
                        size="sm"
                        color="grey-5"
                        @click="copy('claude auth login')"
                    >
                        <q-tooltip>Copy</q-tooltip>
                    </q-btn>
                </div>
            </q-card>

            <q-btn
                outline
                no-caps
                color="grey-4"
                label="I've signed in"
                icon="mdi-check"
                class="q-mt-md full-width"
                @click="retryAuth"
            />
        </div>

        <!-- Connected -->
        <div v-else-if="phase === 'connected'" class="phase-content">
            <q-icon name="mdi-check-circle" color="positive" size="2em" />
            <div class="q-mt-sm text-subtitle2 text-positive">Connected</div>
            <div class="text-caption text-grey-5 q-mt-xs" v-if="cliVersion">
                {{ cliVersion }}
            </div>

            <q-btn
                flat
                no-caps
                dense
                color="grey-5"
                label="Disconnect"
                icon="mdi-connection"
                class="q-mt-md"
                @click="disconnect"
            />
        </div>

        <!-- Error -->
        <div v-else-if="phase === 'error'" class="phase-content">
            <q-icon name="mdi-alert-circle" color="negative" size="2em" />
            <div class="q-mt-sm text-subtitle2 text-negative">Connection failed</div>
            <div class="text-body2 q-mt-xs text-grey-5">{{ errorMessage }}</div>
            <q-btn
                outline
                no-caps
                color="grey-5"
                label="Retry"
                icon="mdi-refresh"
                class="q-mt-md"
                @click="checkAvailability"
            />
        </div>
    </div>
</template>

<style scoped>
.connect-claude {
    min-height: 120px;
}
.phase-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 8px 0;
}
.cmd-card {
    border-radius: 8px;
    width: 100%;
}
</style>
