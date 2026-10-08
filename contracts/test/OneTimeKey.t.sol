// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.sol";
import {Wots} from "./Wots.sol";
import {OneTimeKey} from "../src/OneTimeKey.sol";

/// @dev OneTimeKey.fingerprint takes calldata, so the library is reached through a call.
contract Harness {
    function fingerprint(bytes32 pubSeed, uint64 n, bytes32 m, bytes32[67] calldata sig) external view returns (bytes32) {
        return OneTimeKey.fingerprint(pubSeed, n, m, sig);
    }
}

contract OneTimeKeyTest is Base {
    Harness h = new Harness();
    string constant FILE = "../reference/vectors/v1.json";

    function _sig(string memory json, string memory at) internal pure returns (bytes32[67] memory out) {
        bytes32[] memory s = vm.parseJsonBytes32Array(json, string.concat(at, ".signature"));
        require(s.length == 67, "67 values");
        for (uint256 j; j < 67; ++j) out[j] = s[j];
    }

    function _path(uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".cases[", _str(i), "].", field);
    }

    function _str(uint256 i) internal pure returns (string memory) {
        return string(abi.encodePacked(bytes1(uint8(48 + i))));
    }

    /// Every case in v1.json: the Solidity gives the key's own fingerprint, and the python's signature
    /// for it checks out; every change the vectors list as refused gives something else.
    function test_vectors() public {
        string memory json = vm.readFile(FILE);
        for (uint256 i; i < 7; ++i) {
            string memory at = string.concat(".cases[", _str(i), "]");
            bytes32 pub = vm.parseJsonBytes32(json, _path(i, "pubSeed"));
            uint64 n = uint64(vm.parseJsonUint(json, _path(i, "n")));
            bytes32 m = vm.parseJsonBytes32(json, _path(i, "m"));
            bytes32 key = vm.parseJsonBytes32(json, _path(i, "key"));
            bytes32[67] memory sig = _sig(json, at);

            assertEq(h.fingerprint(pub, n, m, sig), key, "python signature gives the key");
            assertNe(h.fingerprint(pub, n, keccak256(abi.encode(m)), sig), key, "another message");
            assertNe(h.fingerprint(pub, n + 1, m, sig), key, "another key number");
            bytes32[67] memory bad; // a copy: `bad = sig` would point at the same memory
            for (uint256 j; j < 67; ++j) bad[j] = sig[j];
            bad[5] = bytes32(0);
            assertNe(h.fingerprint(pub, n, m, bad), key, "one value changed");

            // and the test-side signer and fingerprint agree with the python's
            bytes32 seed = vm.parseJsonBytes32(json, _path(i, "seed"));
            assertEq(Wots.keyFingerprint(pub, n, seed), key, "test fingerprint");
            bytes32[67] memory mine = Wots.sign(pub, n, seed, m);
            for (uint256 j; j < 67; ++j) {
                if (mine[j] != sig[j]) { emit log_named_uint("case", i); emit log_named_uint("chain", j); }
                assertEq(mine[j], sig[j], "test signature");
            }
        }
    }

    /// A signature for one message never gives the key for a message that is higher in every digit
    /// (the checksum, KICKOFF.md "Why the checksum"): spot check by pushing the first digit up.
    function testFuzz_otherMessageFails(bytes32 seed, bytes32 m, bytes32 m2) public view {
        if (m == m2) return;
        bytes32 pub = sha256("fuzz");
        bytes32 key = Wots.keyFingerprint(pub, 0, seed);
        bytes32[67] memory sig = Wots.sign(pub, 0, seed, m);
        assertEq(h.fingerprint(pub, 0, m, sig), key, "own message");
        assertNe(h.fingerprint(pub, 0, m2, sig), key, "another message");
    }
}
