# Release Pipeline

This project ships desktop installers from `apps/desktop` and publishes the download site from `apps/site`.

## Chosen Approach

- `electron-builder` creates native installers for macOS and Windows from the Electron app.
- Release artifacts are uploaded to Firebase Storage under `releases/<version>/...`.
- `apps/site/public/releases.json` is generated from the uploaded artifact URLs and then deployed through Firebase Hosting.
- GitHub Actions builds macOS and Windows installers on native runners so the release flow is not tied to one developer machine.
- The default local packaging command builds both targets: macOS using the Mac's default architecture and Windows as `x64`.

This is cleaner than mixing binaries into Hosting or trying to cross-build both desktop targets locally.

Desktop packaging defaults to unsigned artifacts unless signing credentials are explicitly present in the environment. That keeps local builds predictable while still allowing signed CI releases.

## Requirements

- Firebase Hosting configured for project `themathhack`
- Firebase Storage enabled for the same project
- Blaze plan if you want to store Windows `.exe` installers in Firebase Storage
- A service account JSON key with access to Firebase Hosting and Cloud Storage
- Optional code-signing credentials if you want signed macOS or Windows builds

## Local Commands

Build both apps:

```sh
npm run build
```

Package the desktop app for the current macOS machine:

```sh
npm run package:desktop
```

Package only the macOS build:

```sh
npm run package:desktop:mac
```

Package only the Windows `x64` build:

```sh
npm run package:desktop:win
```

Upload release artifacts from the default output directory and update the site manifest:

```sh
FIREBASE_STORAGE_BUCKET=themathhack.firebasestorage.app \
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
npm run release:publish
```

Generate the same manifest locally without uploading anything:

```sh
npm run release:publish -- --dry-run
```

Deploy the site after the manifest has been generated:

```sh
npm run release:site
```

Run the full release flow locally: deploy Storage rules, package macOS and Windows, upload both, regenerate the manifest, and deploy Hosting:

```sh
npm run release:deploy
```

## GitHub Secrets

- `FIREBASE_SERVICE_ACCOUNT_JSON`: service account JSON for Firebase Hosting and Cloud Storage
- `FIREBASE_STORAGE_BUCKET`: optional override when the Storage bucket name differs from `themathhack.firebasestorage.app`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`: optional macOS signing/notarization
- `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`: optional Windows signing

## Release Flow

1. Push a tag like `v0.1.0` or run the workflow manually.
2. GitHub Actions builds macOS and Windows installers in parallel.
3. The publish job uploads those artifacts to Firebase Storage.
4. The publish job rewrites `apps/site/public/releases.json`.
5. The site is rebuilt and deployed to Firebase Hosting.
