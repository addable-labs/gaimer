import { ref, reactive } from "vue";
import { defineStore } from "pinia";

export const useProviderStore = defineStore("provider-store", () => {
    const activeProviderId = ref(null);
    const connections = reactive({});

    function setActiveProvider(providerId) {
        activeProviderId.value = providerId;
    }

    function addConnection(providerId, connectionInfo) {
        connections[providerId] = connectionInfo;
    }

    function removeConnection(providerId) {
        delete connections[providerId];
        if (activeProviderId.value === providerId) {
            activeProviderId.value = null;
        }
    }

    function isProviderConnected(providerId) {
        return !!connections[providerId]?.connected;
    }

    return {
        activeProviderId,
        connections,
        setActiveProvider,
        addConnection,
        removeConnection,
        isProviderConnected,
    };
});
