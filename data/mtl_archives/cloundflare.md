# Cloudflare credentials

This file previously stored raw R2 credentials. Delete any secrets from your local copy and rotate the keys you exposed here.

Store live credentials using one of the following mechanisms instead:

- Wrangler secrets
  ```bash
  wrangler secret put R2_ACCESS_KEY_ID
  wrangler secret put R2_SECRET_ACCESS_KEY
  ```
- Local `.env` file (ignored by git) loaded by your deployment scripts
- External secret manager (1Password, Doppler, Vault, etc.)

Required values:

- `R2_ACCOUNT_ID`
- `R2_BUCKET`
- `R2_PUBLIC_DOMAIN`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Update the project README with your chosen approach and remove this placeholder file if you no longer need on-disk documentation.
