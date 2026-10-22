# Security

MechPilot runs entirely on your computer. It opens no network connection unless you enable the
optional AI assistant with your own API key, and then it talks only to the provider you chose.

## What is protected

- The renderer runs with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`.
  It reaches the file system and the network only through the typed API in the preload script.
- API keys are stored encrypted with Electron `safeStorage` in the app's data folder and never
  reach the renderer or any file in the repository.
- Opened files (`.mechpilot.json`, DXF, STEP) are parsed as data. No file can run code.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability
reporting on the repository (Security tab, "Report a vulnerability"). You will get an answer within
seven days. Fixes ship in the next release and are credited in `CHANGELOG.md` unless you prefer
otherwise.
