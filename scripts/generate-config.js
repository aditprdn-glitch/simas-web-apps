// Runs as Vercel's build step. Writes config.js from environment variables set in the
// Vercel project dashboard (Settings > Environment Variables), so the real credentials
// and tokens never have to be committed to git to reach production.
const fs = require('fs');
const path = require('path');

const requiredVars = [
    'WEB_APP_URL',
    'API_TOKEN',
    'SUPERUSER_TOKEN',
    'SUPERUSER_ID',
    'SUPERUSER_PIN',
    'USER_ID',
    'USER_PIN'
];

const missing = requiredVars.filter((key) => !process.env[key]);
if (missing.length > 0) {
    console.error(`generate-config: missing required environment variable(s): ${missing.join(', ')}`);
    console.error('Set these in the Vercel project dashboard under Settings > Environment Variables.');
    process.exit(1);
}

const configContent = `// AUTO-GENERATED at build time by scripts/generate-config.js from Vercel environment
// variables. Do not edit by hand and do not commit this file — it is gitignored.
const CONFIG = {
    WEB_APP_URL: "${process.env.WEB_APP_URL}",
    API_TOKEN: "${process.env.API_TOKEN}",
    SUPERUSER_TOKEN: "${process.env.SUPERUSER_TOKEN}",
    USERS: {
        SUPERUSER: { id: "${process.env.SUPERUSER_ID}", pin: "${process.env.SUPERUSER_PIN}" },
        USER: { id: "${process.env.USER_ID}", pin: "${process.env.USER_PIN}" }
    }
};
`;

fs.writeFileSync(path.join(__dirname, '..', 'config.js'), configContent);
console.log('generate-config: config.js written successfully.');
