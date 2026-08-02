// Template konfigurasi SIMAS 263.
//
// Cara pakai: salin file ini menjadi "config.js" di folder yang sama, lalu isi
// nilai di bawah dengan nilai asli. "config.js" sengaja di-gitignore dan TIDAK
// boleh pernah di-commit ke repository, karena berisi kredensial dan token asli.
const CONFIG = {
    WEB_APP_URL: "https://script.google.com/macros/s/REPLACE_WITH_YOUR_DEPLOYMENT_ID/exec",
    API_TOKEN: "REPLACE_WITH_A_STRONG_RANDOM_TOKEN",
    SUPERUSER_TOKEN: "REPLACE_WITH_A_DIFFERENT_STRONG_RANDOM_TOKEN",
    USERS: {
        SUPERUSER: { id: "REPLACE_WITH_SUPERUSER_ID", pin: "REPLACE_WITH_SUPERUSER_PIN" },
        USER: { id: "REPLACE_WITH_USER_ID", pin: "REPLACE_WITH_USER_PIN" }
    }
};
