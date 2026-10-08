// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Signing, for tests only (the page does this in JavaScript from the passkey's PRF). Written
/// from the spec in KICKOFF.md, not from OneTimeKey, so the two can disagree.
library Wots {
    function secret(bytes32 seed, uint256 j) internal pure returns (bytes32) {
        return sha256(abi.encodePacked("sign-and-burn/sk/v1", seed, uint8(j)));
    }

    function walk(bytes32 pubSeed, uint64 n, uint256 j, bytes32 x, uint256 from, uint256 to) internal pure returns (bytes32) {
        for (uint256 s = from; s < to; ++s) x = sha256(abi.encodePacked(pubSeed, n, uint8(j), uint8(s), x));
        return x;
    }

    function keyFingerprint(bytes32 pubSeed, uint64 n, bytes32 seed) internal pure returns (bytes32) {
        bytes memory ends;
        for (uint256 j; j < 67; ++j) ends = bytes.concat(ends, walk(pubSeed, n, j, secret(seed, j), 0, 15));
        return sha256(abi.encodePacked(pubSeed, n, ends));
    }

    function digits(bytes32 m) internal pure returns (uint256[67] memory d) {
        uint256 sum;
        for (uint256 i; i < 64; ++i) {
            d[i] = (uint256(m) >> (252 - 4 * i)) & 15;
            sum += 15 - d[i];
        }
        d[64] = sum >> 8;
        d[65] = (sum >> 4) & 15;
        d[66] = sum & 15;
    }

    function sign(bytes32 pubSeed, uint64 n, bytes32 seed, bytes32 m) internal pure returns (bytes32[67] memory sig) {
        uint256[67] memory d = digits(m);
        for (uint256 j; j < 67; ++j) sig[j] = walk(pubSeed, n, j, secret(seed, j), 0, d[j]);
    }
}
