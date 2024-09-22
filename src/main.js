import { createApp } from "vue";
import App from "./App.vue";

// ---------------------------------------------------------------------------------------------
// Create the app
const app = createApp(App);

// ---------------------------------------------------------------------------------------------
// Import and make Quasar available in the app
import { Quasar, Dark, Dialog, Notify } from "quasar";
import quasarIconSet from "quasar/icon-set/svg-mdi-v7";
import "@quasar/extras/mdi-v7/mdi-v7.css";
import "quasar/dist/quasar.css";
// Custom styles
// import "./styles.css";

app.use(Quasar, {
    plugins: { Dark, Dialog, Notify }, // import Quasar plugins and add here
    config: {
        dark: "auto",
        notify: {},
        brand: {},
    },
    iconSet: quasarIconSet,
    extras: ["material-icons", "mdi-v7"],
    /*
    config: {
      brand: {
        // primary: '#e46262',
        // ... or all other brand colors
      },
      notify: {...}, // default set of options for Notify Quasar plugin
      loading: {...}, // default set of options for Loading Quasar plugin
      loadingBar: { ... }, // settings for LoadingBar Quasar plugin
      // ..and many more (check Installation card on each Quasar component/directive/plugin)
    }
    */
});

// ---------------------------------------------------------------------------------------------
// Make pinia available in the app
import { createPinia } from "pinia";
const pinia = createPinia();
app.use(pinia);

// ---------------------------------------------------------------------------------------------
// Mount the app
app.mount("#app");
