// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {OneTimeKey} from "./OneTimeKey.sol";

interface ISafeApprove {
    function approveHash(bytes32 hashToApprove) external;
}

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

/// @notice One owner of a Safe. It approves a Safe transaction only when given a P-256 passkey
/// signature and the current one-time signature, and every approval names the next one-time key:
/// the key that just signed is dead. No admin, no upgrade, no recovery key.
contract Seat {
    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;

    address public immutable curveSigner; // the passkey's SafeWebAuthnSignerProxy
    uint32 public immutable seatNumber;
    bytes32 public immutable pubSeed;

    bytes32 public current; // fingerprint of one-time key n
    uint64 public n; // how many approvals this seat has made
    // The block approval k landed in. Public RPCs search logs only a few hundred blocks at a time, so
    // the page finds each Approved event (and the one-time signature it revealed) from here.
    mapping(uint64 => uint256) public approvedIn;

    event Approved(address indexed safe, bytes32 indexed safeTxHash, uint64 indexed n, bytes32 nextKey);

    error BadNextKey();
    error BadOneTimeSignature();
    error BadCurveSignature();

    constructor(address curveSigner_, uint32 seatNumber_, bytes32 firstKey) {
        curveSigner = curveSigner_;
        seatNumber = seatNumber_;
        pubSeed = sha256(abi.encodePacked("sign-and-burn/seed/v1", block.chainid, curveSigner_, seatNumber_));
        current = firstKey;
    }

    /// @notice Anyone may call this. Everything in the call is bound by the signatures, so a copied
    /// call can only do exactly what was signed. If this seat is not an owner of `safe`, the Safe
    /// reverts and the key is not spent.
    function approve(
        address safe,
        bytes32 safeTxHash,
        bytes32 nextKey,
        bytes32[67] calldata oneTime,
        bytes calldata curveSig
    ) external {
        uint64 k = n; // never a number from the call
        bytes32 cur = current;
        if (nextKey == bytes32(0) || nextKey == cur) revert BadNextKey();

        bytes32 c = sha256(abi.encodePacked("sign-and-burn/approve/v1", block.chainid, address(this), safe, k, safeTxHash));
        bytes32 m = sha256(abi.encodePacked("sign-and-burn/one-time/v1", c, nextKey));
        if (OneTimeKey.fingerprint(pubSeed, k, m, oneTime) != cur) revert BadOneTimeSignature();
        if (IERC1271(curveSigner).isValidSignature(c, curveSig) != ERC1271_MAGIC) revert BadCurveSignature();

        current = nextKey;
        n = k + 1; // reverts at 2^64 - 1: there is no key after the last one
        approvedIn[k] = block.number;
        emit Approved(safe, safeTxHash, k, nextKey);
        ISafeApprove(safe).approveHash(safeTxHash);
    }
}
