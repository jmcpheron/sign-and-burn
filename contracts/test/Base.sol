// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Just the cheatcodes these tests use, declared here so there is no library to pin.
interface Vm {
    function prank(address) external;
    function chainId(uint256) external;
    function store(address, bytes32, bytes32) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function expectEmit(bool, bool, bool, bool, address) external;
    function readFile(string calldata) external view returns (string memory);
    function parseJsonString(string calldata, string calldata) external pure returns (string memory);
    function parseJsonUint(string calldata, string calldata) external pure returns (uint256);
    function parseJsonBytes32(string calldata, string calldata) external pure returns (bytes32);
    function parseJsonBytes32Array(string calldata, string calldata) external pure returns (bytes32[] memory);
    function parseJsonAddress(string calldata, string calldata) external pure returns (address);
    function parseJsonBytes(string calldata, string calldata) external pure returns (bytes memory);
    function etch(address, bytes calldata) external;
    function deal(address, uint256) external;
    function publicKeyP256(uint256 privateKey) external pure returns (uint256 x, uint256 y);
    function signP256(uint256 privateKey, bytes32 digest) external pure returns (bytes32 r, bytes32 s);
}

abstract contract Base {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event log_named_uint(string key, uint256 val);

    function assertEq(bytes32 a, bytes32 b, string memory why) internal pure {
        require(a == b, why);
    }

    function assertNe(bytes32 a, bytes32 b, string memory why) internal pure {
        require(a != b, why);
    }

    function assertEq(uint256 a, uint256 b, string memory why) internal pure {
        require(a == b, why);
    }

    function assertTrue(bool a, string memory why) internal pure {
        require(a, why);
    }
}
