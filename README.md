# ForesomeLiveApp

This repository is configured for GitHub Pages deployment to a custom domain.

## GitHub Pages settings

- Branch: `main`
- Folder: the workflow publishes the generated `dist/`
- Custom domain: `foresomekc.com`

## Files that configure deployment

- `.github/workflows/pages.yml` — builds the app and deploys `dist/`
- `CNAME` — specifies the custom domain `foresomekc.com`

## DNS requirements

Add the following A records for `foresomekc.com`:

- `185.199.108.153`
- `185.199.109.153`
- `185.199.110.153`
- `185.199.111.153`

If you need help verifying your GitHub Pages settings in the repo, I can guide you through the exact UI steps.
