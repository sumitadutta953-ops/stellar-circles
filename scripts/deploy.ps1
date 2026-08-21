$ErrorActionPreference = 'Stop'

Write-Host "Setting up identity for Testnet..."
try {
    stellar keys generate admin --network testnet --fund 2>$null
} catch {
    Write-Host "Admin key already exists or failed, skipping."
}

Write-Host "Deploying passkey-wallet WASM to Testnet..."
$passkeyWalletWasmHash = (stellar contract install --wasm "..\contracts\target\wasm32v1-none\release\passkey_wallet.wasm" --source admin --network testnet)
Write-Host "passkey-wallet WASM hash: $passkeyWalletWasmHash"

Write-Host "Deploying passkey-factory contract to Testnet..."
$passkeyFactoryId = (stellar contract deploy --wasm "..\contracts\target\wasm32v1-none\release\passkey_factory.wasm" --source admin --network testnet)
Write-Host "passkey-factory ID: $passkeyFactoryId"

Write-Host "Initializing passkey-factory..."
stellar contract invoke --id $passkeyFactoryId --source admin --network testnet -- init --wallet_wasm_hash $passkeyWalletWasmHash

Write-Host "Deploying contribution contract to Testnet..."
$contributionId = (stellar contract deploy --wasm "..\contracts\target\wasm32v1-none\release\contribution.wasm" --source admin --network testnet)
Write-Host "contribution ID: $contributionId"

Write-Host "Deploying payout contract to Testnet..."
$payoutId = (stellar contract deploy --wasm "..\contracts\target\wasm32v1-none\release\payout.wasm" --source admin --network testnet)
Write-Host "payout ID: $payoutId"

Write-Host "Deploying default-handler contract to Testnet..."
$defaultHandlerId = (stellar contract deploy --wasm "..\contracts\target\wasm32v1-none\release\default_handler.wasm" --source admin --network testnet)
Write-Host "default-handler ID: $defaultHandlerId"

Write-Host "Deploying reputation contract to Testnet..."
$reputationId = (stellar contract deploy --wasm "..\contracts\target\wasm32v1-none\release\reputation.wasm" --source admin --network testnet)
Write-Host "reputation ID: $reputationId"

Write-Host "Deploying circle-factory contract to Testnet..."
$circleFactoryId = (stellar contract deploy --wasm "..\contracts\target\wasm32v1-none\release\circle_factory.wasm" --source admin --network testnet)
Write-Host "circle-factory ID: $circleFactoryId"

Write-Host "Initializing circle-factory..."
$adminKey = (stellar keys address admin)
stellar contract invoke --id $circleFactoryId --source admin --network testnet -- init --admin $adminKey

Write-Host "Initializing contribution contract..."
stellar contract invoke --id $contributionId --source admin --network testnet -- init --factory $circleFactoryId

Write-Host "Initializing payout contract..."
stellar contract invoke --id $payoutId --source admin --network testnet -- init --factory $circleFactoryId --contribution_contract $contributionId

# Write the IDs to the frontend's .env file
$envContent = @"

VITE_PASSKEY_FACTORY_ID=$passkeyFactoryId
VITE_CONTRIBUTION_ID=$contributionId
VITE_PAYOUT_ID=$payoutId
VITE_DEFAULT_HANDLER_ID=$defaultHandlerId
VITE_REPUTATION_ID=$reputationId
VITE_CIRCLE_FACTORY_ID=$circleFactoryId
"@

Add-Content -Path "..\frontend\.env" -Value $envContent
Write-Host "Successfully wrote Contract IDs to frontend/.env!"
