// Runs as Vercel's build step.
//
// Vercel doesn't reliably pick up files a build command creates in-place inside the
// source directory when outputDirectory points at that same source directory. So instead
// this copies the static site into a dedicated public/ output folder and writes config.js
// there too, generated from environment variables set in the Vercel project dashboard
// (Settings > Environment Variables) — the real credentials/tokens never have to be
// committed to git to reach production.
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const outDir = path.join(rootDir, 'public');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const staticEntries = ['index.html', 'css', 'js', 'asset'];
for (const entry of staticEntries) {
    const src = path.join(rootDir, entry);
    if (fs.existsSync(src)) {
        fs.cpSync(src, path.join(outDir, entry), { recursive: true });
    }
}

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
    console.error(`build: missing required environment variable(s): ${missing.join(', ')}`);
    console.error('Set these in the Vercel project dashboard under Settings > Environment Variables.');
    process.exit(1);
}

const configContent = `// AUTO-GENERATED at build time by scripts/build.js from Vercel environment
// variables. Do not edit by hand and do not commit this file.
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

fs.writeFileSync(path.join(outDir, 'config.js'), configContent);
console.log(`build: copied ${staticEntries.join(', ')} and generated config.js into /public`);
