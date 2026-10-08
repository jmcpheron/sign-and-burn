// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Winternitz one-time signatures, w = 16, 67 chains, SHA-256, tweaked per step.
/// Byte for byte the same as reference/python/sign_and_burn.py (reference/vectors/v1.json).
library OneTimeKey {
    uint256 internal constant CHAINS = 67;
    uint256 internal constant STEPS = 15;

    /// @return the fingerprint the signature `sig` is for: step every revealed value to the top of
    /// its chain, then hash the ends. The signature is good for key `n` exactly when this is K(n).
    function fingerprint(bytes32 pubSeed, uint64 n, bytes32 m, bytes32[67] calldata sig) internal view returns (bytes32) {
        bytes32[67] memory ends;
        uint256 checksum;
        for (uint256 j; j < 64; ++j) {
            uint256 d = (uint256(m) >> (252 - 4 * j)) & 15;
            checksum += STEPS - d;
            ends[j] = _advance(pubSeed, n, j, sig[j], d);
        }
        // the checksum, at most 960, as three digits: pushing a message digit up pushes it down
        ends[64] = _advance(pubSeed, n, 64, sig[64], checksum >> 8);
        ends[65] = _advance(pubSeed, n, 65, sig[65], (checksum >> 4) & 15);
        ends[66] = _advance(pubSeed, n, 66, sig[66], checksum & 15);
        return sha256(abi.encodePacked(pubSeed, n, ends));
    }

    /// @dev `x` is at position `start` on chain `j`; walk it to the top.
    function _advance(bytes32 pubSeed, uint64 n, uint256 j, bytes32 x, uint256 start) private view returns (bytes32) {
        for (uint256 s = start; s < STEPS; ++s) {
            x = sha256(abi.encodePacked(pubSeed, n, uint8(j), uint8(s), x));
        }
        return x;
    }
}
