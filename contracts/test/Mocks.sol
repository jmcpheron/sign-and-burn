// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Stands in for a Safe: records approveHash from its owners and refuses everyone else.
contract MockSafe {
    mapping(address => bool) public isOwner;
    mapping(address => mapping(bytes32 => bool)) public approvedHashes;
    uint256 public calls;

    function addOwner(address o) external {
        isOwner[o] = true;
    }

    function approveHash(bytes32 h) external {
        require(isOwner[msg.sender], "GS030");
        approvedHashes[msg.sender][h] = true;
        ++calls;
    }
}

/// @dev Stands in for the passkey's signer: a signature is good when it is exactly abi.encode(hash).
contract MockCurveSigner {
    function isValidSignature(bytes32 hash, bytes calldata sig) external pure returns (bytes4) {
        return keccak256(sig) == keccak256(abi.encode(hash)) ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
