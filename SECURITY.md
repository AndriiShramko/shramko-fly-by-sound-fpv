# Security and privacy

## What leaves your computer

- **Nothing from this repository.** The engine, the lessons and the demo make no network requests and store nothing in the browser.
- **Recording and sending happen in the simulator** (ShramkoGSFPV), not here:
  - the microphone is used only after the pilot allows it, and the recording stays on the device;
  - a session package is sent to the author only after a separate confirmation by the pilot or a helper;
  - for anyone under 18, the helper must confirm a parent's signed consent first, and this repository's session writer refuses a minor's package that claims consent to send without it;
  - optional speech recognition ("send it to the author" by voice) uses the browser's service, which sends audio to the browser vendor; it is off by default and disclosed before use.

## Reporting a vulnerability

Please email **zmei116@gmail.com** with "SECURITY" in the subject. Do not open a public issue for vulnerabilities. You will get an answer within a few days.

## Secrets

This repository holds no keys, tokens or personal data, and every push is scanned for them first. If you fork it, keep it that way: never commit `.env` files, server configuration or recordings of real testers.

See also [docs/warnings.md](docs/warnings.md) for hearing safety and other risks.
