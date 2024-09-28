import { createApp } from "vue";
import App from "./App.vue";

// ---------------------------------------------------------------------------------------------
// Create the app
const app = createApp(App);

// ---------------------------------------------------------------------------------------------
// Import and make Quasar available in the app
import { Quasar, Dark, Notify } from "quasar";
import quasarIconSet from "quasar/icon-set/svg-mdi-v7";
import "@quasar/extras/mdi-v7/mdi-v7.css";
import "quasar/dist/quasar.css";
// Custom styles
import "./styles.css";

app.use(Quasar, {
    plugins: { Dark, Notify }, // import Quasar plugins and add here
    config: {
        dark: "auto",
        notify: {},
        brand: { primary: "#83F35D", secondary: "#FF6F00" },
    },
    iconSet: quasarIconSet,
    extras: ["material-icons", "mdi-v7"],
});

// ---------------------------------------------------------------------------------------------
// Make pinia available in the app
import { createPinia } from "pinia";
const pinia = createPinia();
app.use(pinia);

// ---------------------------------------------------------------------------------------------
// Mount the app
app.mount("#app");
