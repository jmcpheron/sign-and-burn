# The console's pinned config: the chain it signs for and the contracts it relies on. Nothing here
# comes from the page, the wallet or the chain. The page reads this same file for its RPC endpoint
# and the addresses it calls, so it is JSON on purpose (double quotes, no True/None, no trailing
# commas), and site/build.mjs parses it.
#
# "chains" is every chain the console will sign for: Base Sepolia, and nothing else. A development
# build adds the local Anvil chain (31337) here, with Base Sepolia's contracts at the same addresses
# (tools/chain/anvil.mjs); the published build can't contain it, and site/build.mjs checks that.
#
# "safe" is Safe 1.4.1 L2 at Safe's canonical addresses. "signer" is Safe's passkey signer,
# safe-modules passkey 0.2.1: "proxyCode" is the SafeWebAuthnSignerProxy creation code its factory
# deploys, so the console works out the passkey's signer address itself (webauthn.owner_address).
# "verifiers" is the P-256 precompile at 0x100 first, then Daimo's verifier; it is part of the
# signer's address, so it never changes. "seatFactory" is ours, deployed through the CREATE2
# deployer, so it has the same address on every chain (contracts/deployment.json). tools/chain
# checks every address here against Base Sepolia.
#
# "tokens", "batchers", "contracts", "delegates" and "book" are decode.py's: what the console can
# name. Keyed by chain ID; "*" is the same contract on every chain. "delegates" is empty on purpose:
# the console refuses every delegatecall except a multiSend to a pinned batcher.
CFG = {
    "chains": {
        "84532": {"name": "Base Sepolia", "rpc": "https://sepolia.base.org", "explorer": "https://sepolia.basescan.org"}
    },
    "safe": {
        "version": "1.4.1",
        "singleton": "0x29fcb43b46531bca003ddc8fcb67ffe91900c762",
        "factory": "0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67",
        "fallbackHandler": "0xfd0732dc9e303f09fcef3a7388ad10a83459ec99"
    },
    "multicall": "0xca11bde05977b3631167028862be2a173976ca11",
    "create2Deployer": "0x4e59b44847b379578588920ca78fbf26c0b4956c",
    "seatFactory": "0x0a6514135d34dfd19c3f1a636f3e952caeba3871",
    "signer": {
        "factory": "0x1d31f259ee307358a26dfb23eb365939e8641195",
        "singleton": "0x4e27b51350e6c2083ee19011120f50dafec5ca50",
        "verifiers": "0x0100c2b78104907f722dabac4c69f826a522b2754de4",
        "proxyCode": "610100346100ad57601f6101b538819003918201601f19168301916001600160401b038311848410176100b2578084926080946040528339810103126100ad578051906001600160a01b03821682036100ad5760208101516040820151606090920151926001600160b01b03841684036100ad5760805260a05260c05260e05260405160ec90816100c98239608051816082015260a05181604d015260c051816027015260e0518160010152f35b600080fd5b634e487b7160e01b600052604160045260246000fdfe7f000000000000000000000000000000000000000000000000000000000000000060b63601527f000000000000000000000000000000000000000000000000000000000000000060a03601527f000000000000000000000000000000000000000000000000000000000000000036608001523660006080376000806056360160807f00000000000000000000000000000000000000000000000000000000000000005af43d600060803e60b1573d6080fd5b3d6080f3fea26469706673582212201660515548d15702d720bbc046b457ca85e941a4559ab9f9518488e4c82e5ee964736f6c634300081a0033"
    },
    "sameAs": {},
    "tokens": {
        "84532": {"0x036cbd53842c5426634e7929541ec2318f3dcf7e": ["USDC", 6]}
    },
    "batchers": {
        "*": {"0x9641d764fc13c8b624c04430c7356c1c7c8102e2": "MultiSendCallOnly 1.4.1"}
    },
    "contracts": {
        "*": {"0x9641d764fc13c8b624c04430c7356c1c7c8102e2": ["Safe MultiSend", "safe", {}]},
        "84532": {"0x036cbd53842c5426634e7929541ec2318f3dcf7e": ["USDC", "usdc", {}]}
    },
    "delegates": {},
    "book": {}
}
