# GitHub Actions Secrets Setup

To run the full CI/CD pipeline, configure the following secrets in your GitHub repository:
**Settings → Secrets and variables → Actions → New repository secret**

## Required for Contract Deployment (CD)

| Secret | Description |
|---|---|
| `STELLAR_SECRET_KEY` | Stellar secret key (`S...`) for the deployer account — must have XLM on Testnet |

## Required for Frontend Deployment (CD)

| Secret | Description |
|---|---|
| `VERCEL_TOKEN` | Vercel personal access token — from [vercel.com/account/tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Your Vercel organization/team ID — from project settings |
| `VERCEL_PROJECT_ID` | Your Vercel project ID — from project settings |

## Required for Frontend Build (CI + CD)

These are the same values from your `frontend/.env` file:

| Secret | Description |
|---|---|
| `VITE_CIRCLE_FACTORY_ID` | Deployed CircleFactory contract C-address |
| `VITE_CONTRIBUTION_ID` | Deployed Contribution contract C-address |
| `VITE_PAYOUT_ID` | Deployed Payout contract C-address |
| `VITE_PASSKEY_FACTORY_ID` | Deployed PasskeyFactory contract C-address |
| `VITE_REPUTATION_ID` | Deployed Reputation contract C-address |
| `VITE_DEFAULT_HANDLER_ID` | Deployed DefaultHandler contract C-address |
| `VITE_FIREBASE_API_KEY` | Firebase API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |

## Optional

| Secret | Description |
|---|---|
| `VITE_POSTHOG_KEY` | PostHog project API key for analytics |
| `VITE_SENTRY_DSN` | Sentry DSN for error monitoring |

## Triggering Contract Deployment

Contract deployment is **not automatic** on every push (to avoid creating new
contract IDs on each commit). To deploy contracts:

**Option 1**: Trigger manually
- Go to Actions → CD Pipeline → Run workflow → check "Deploy Soroban contracts to Testnet"

**Option 2**: Include `[deploy-contracts]` in your commit message
```bash
git commit -m "chore: deploy updated payout contract [deploy-contracts]"
```

After deployment, the job log will print all contract IDs. Copy them into your
`frontend/.env` and into the GitHub secrets above.
