// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.sol";
import {Wots} from "./Wots.sol";
import {Seat} from "../src/Seat.sol";
import {SeatFactory} from "../src/SeatFactory.sol";

// The real contracts, as Base Sepolia runs them (tools/chain/code.json), called through these.
interface ISignerFactory {
    function createSigner(uint256 x, uint256 y, uint176 verifiers) external returns (address);
    function getSigner(uint256 x, uint256 y, uint176 verifiers) external view returns (address);
}

interface IProxyFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce) external returns (address);
}

interface ISafe {
    function setup(address[] calldata, uint256, address, bytes calldata, address, address, uint256, address) external;
    function execTransaction(address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas,
        uint256 gasPrice, address gasToken, address refundReceiver, bytes calldata signatures) external payable returns (bool);
    function getTransactionHash(address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas,
        uint256 gasPrice, address gasToken, address refundReceiver, uint256 nonce) external view returns (bytes32);
    function nonce() external view returns (uint256);
    function approvedHashes(address, bytes32) external view returns (uint256);
    function isOwner(address) external view returns (bool);
    function getThreshold() external view returns (uint256);
}

interface IMulticall3 {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory);
}

/// @dev The seat with the real Safe 1.4.1 L2, the real passkey signer (safe-modules passkey 0.2.1)
/// and Multicall3, put at their Base Sepolia addresses with vm.etch, and a real P-256 key signing
/// WebAuthn assertions the way a browser's passkey does. evm_version cancun has no P-256 precompile
/// at 0x100, so the signer checks with its fallback, Daimo's P-256 verifier.
contract IntegrationTest is Base {
    uint256 constant N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551; // P-256's order
    uint176 constant VERIFIERS = 0x0100c2b78104907f722dabac4c69f826a522b2754de4; // precompile 0x100, then Daimo's verifier
    uint256 constant PASSKEY = 0x5ec2e7; // a test key, public and worthless
    string constant FIELDS = '"origin":"https://signandburn.app","crossOrigin":false';

    ISafe singletonL2;
    IProxyFactory proxyFactory;
    address fallbackHandler;
    IMulticall3 multicall;
    ISignerFactory signerFactory;
    address deployer;

    SeatFactory factory;
    address signer;
    Seat seat;
    ISafe safe;
    address constant RECIPIENT = address(0xC0FFEE);

    function _real(string memory json, string memory name) internal returns (address a) {
        a = vm.parseJsonAddress(json, string.concat(".contracts.", name, ".address"));
        vm.etch(a, vm.parseJsonBytes(json, string.concat(".contracts.", name, ".code")));
    }

    function seedOf(uint64 n) internal pure returns (bytes32) {
        return sha256(abi.encodePacked("integration seed", n));
    }

    function setUp() public {
        string memory code = vm.readFile("../tools/chain/code.json");
        singletonL2 = ISafe(_real(code, "SafeL2"));
        proxyFactory = IProxyFactory(_real(code, "SafeProxyFactory"));
        fallbackHandler = _real(code, "CompatibilityFallbackHandler");
        multicall = IMulticall3(_real(code, "Multicall3"));
        signerFactory = ISignerFactory(_real(code, "SafeWebAuthnSignerFactory"));
        _real(code, "SafeWebAuthnSignerSingleton");
        _real(code, "DaimoP256Verifier");
        deployer = _real(code, "Create2Deployer");

        // The factory, as the page deploys it: the deployer, salt 0, the init code in deployment.json.
        string memory dep = vm.readFile("deployment.json");
        bytes memory init = vm.parseJsonBytes(dep, ".SeatFactory.initCode");
        assertEq(keccak256(init), keccak256(type(SeatFactory).creationCode), "deployment.json is this build");
        (bool ok, bytes memory ret) = deployer.call(abi.encodePacked(bytes32(0), init));
        assertTrue(ok && ret.length == 20, "deployed");
        factory = SeatFactory(address(bytes20(ret)));
        assertTrue(address(factory) == vm.parseJsonAddress(dep, ".SeatFactory.address"), "where deployment.json says");

        (uint256 x, uint256 y) = vm.publicKeyP256(PASSKEY);
        signer = signerFactory.createSigner(x, y, VERIFIERS);
        assertTrue(signer == signerFactory.getSigner(x, y, VERIFIERS), "the passkey's signer");

        bytes32 pub = sha256(abi.encodePacked("sign-and-burn/seed/v1", block.chainid, signer, uint32(0)));
        seat = Seat(factory.createSeat(signer, 0, Wots.keyFingerprint(pub, 0, seedOf(0))));

        address[] memory owners = new address[](1);
        owners[0] = address(seat);
        bytes memory setup = abi.encodeCall(ISafe.setup, (owners, 1, address(0), "", fallbackHandler, address(0), 0, address(0)));
        safe = ISafe(proxyFactory.createProxyWithNonce(address(singletonL2), setup, uint256(uint160(address(seat)))));
        assertTrue(safe.isOwner(address(seat)) && safe.getThreshold() == 1, "a 1-of-1 Safe owned by the seat");
        vm.deal(address(safe), 1 ether);
    }

    // ---- the passkey, as a browser's

    function b64url(bytes memory data) internal pure returns (string memory) {
        bytes memory t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        bytes memory out = new bytes((data.length * 8 + 5) / 6);
        for (uint256 i; i < out.length; ++i) {
            uint256 bit = i * 6;
            uint256 w = uint256(uint8(data[bit / 8])) << 8;
            if (bit / 8 + 1 < data.length) w |= uint8(data[bit / 8 + 1]);
            out[i] = t[(w >> (10 - bit % 8)) & 63];
        }
        return string(out);
    }

    /// abi.encode(authenticatorData, clientDataFields, r, s), the shape Safe's passkey signer takes,
    /// over a WebAuthn assertion whose challenge is `challenge`.
    function passkeySig(bytes32 challenge, bytes1 flags) internal pure returns (bytes memory) {
        bytes memory ad = abi.encodePacked(sha256("signandburn.app"), flags, uint32(7));
        bytes memory cdj = abi.encodePacked('{"type":"webauthn.get","challenge":"', b64url(abi.encodePacked(challenge)), '",', FIELDS, "}");
        (bytes32 r, bytes32 s) = vm.signP256(PASSKEY, sha256(abi.encodePacked(ad, sha256(cdj))));
        uint256 low = uint256(s) > N / 2 ? N - uint256(s) : uint256(s);
        return abi.encode(ad, FIELDS, uint256(r), low);
    }

    // ---- one press: approve and run, in one Multicall3 call

    struct Press {
        bytes32 stx;
        bytes32 next;
        bytes32[67] oneTime;
        bytes curve;
        IMulticall3.Call3[] calls;
    }

    function press(uint256 value, bytes1 flags, bytes32 curveChallenge) internal view returns (Press memory p) {
        uint64 n = seat.n();
        uint256 nonce = safe.nonce();
        p.stx = safe.getTransactionHash(RECIPIENT, value, "", 0, 0, 0, 0, address(0), address(0), nonce);
        bytes32 c = sha256(abi.encodePacked("sign-and-burn/approve/v1", block.chainid, address(seat), address(safe), n, p.stx));
        p.next = Wots.keyFingerprint(seat.pubSeed(), n + 1, seedOf(n + 1));
        p.oneTime = Wots.sign(seat.pubSeed(), n, seedOf(n), sha256(abi.encodePacked("sign-and-burn/one-time/v1", c, p.next)));
        p.curve = passkeySig(curveChallenge == bytes32(0) ? c : curveChallenge, flags);
        p.calls = new IMulticall3.Call3[](2);
        p.calls[0] = IMulticall3.Call3(address(seat), false, abi.encodeCall(Seat.approve, (address(safe), p.stx, p.next, p.oneTime, p.curve)));
        // the seat's vote, as Safe reads a pre-approved hash: r = the owner, s = 0, v = 1
        bytes memory sigs = abi.encodePacked(bytes32(uint256(uint160(address(seat)))), bytes32(0), uint8(1));
        p.calls[1] = IMulticall3.Call3(address(safe), true,
            abi.encodeCall(ISafe.execTransaction, (RECIPIENT, value, "", 0, 0, 0, 0, address(0), address(0), sigs)));
    }

    function send(Press memory p) internal returns (IMulticall3.Result[] memory res, uint256 gas) {
        gas = gasleft();
        res = multicall.aggregate3(p.calls);
        gas -= gasleft();
    }

    function test_twoPressesOnTheRealStack() public {
        for (uint64 i; i < 2; ++i) {
            Press memory p = press(0.01 ether, 0x05, 0);
            (IMulticall3.Result[] memory res, uint256 gas) = send(p);
            emit log_named_uint("gas, approve + execTransaction through Multicall3", gas);
            emit log_named_uint("calldata bytes", abi.encodeCall(IMulticall3.aggregate3, (p.calls)).length);
            assertTrue(res[1].success, "the Safe transaction ran");
            assertEq(RECIPIENT.balance, 0.01 ether * (i + 1), "sent");
            assertEq(safe.nonce(), i + 1, "Safe nonce");
            assertEq(seat.n(), i + 1, "seat n");
            assertEq(seat.current(), Wots.keyFingerprint(seat.pubSeed(), i + 1, seedOf(i + 1)), "the next key is current");
            assertEq(seat.approvedIn(i), block.number, "approvedIn");
        }
    }

    // Refusals call the seat directly: Multicall3 replaces the seat's error with "call failed".
    function approveDirectly(Press memory p) internal {
        seat.approve(address(safe), p.stx, p.next, p.oneTime, p.curve);
    }

    function test_curveSignatureOverAnotherApproval() public {
        Press memory p = press(0.01 ether, 0x05, sha256("another approval"));
        vm.expectRevert(Seat.BadCurveSignature.selector);
        approveDirectly(p);
    }

    function test_curveSignatureWithoutUserVerification() public {
        Press memory p = press(0.01 ether, 0x01, 0); // user present, not verified
        vm.expectRevert(Seat.BadCurveSignature.selector);
        approveDirectly(p);
    }

    function test_refusedThroughMulticallToo() public {
        Press memory p = press(0.01 ether, 0x01, 0);
        vm.expectRevert(bytes("Multicall3: call failed"));
        send(p);
        assertEq(seat.n(), 0, "nothing burned");
    }

    function test_approvalLandsWhenTheTransactionCannotRun() public {
        Press memory p = press(2 ether, 0x05, 0); // the Safe holds 1 ether
        (IMulticall3.Result[] memory res,) = send(p);
        assertTrue(!res[1].success, "the Safe transaction failed");
        assertEq(seat.n(), 1, "the key is burned anyway");
        assertEq(safe.nonce(), 0, "the Safe nonce did not move");
        assertEq(safe.approvedHashes(address(seat), p.stx), 1, "the vote stands");
        // once the Safe has the money, anyone can run it with the vote already there
        vm.deal(address(safe), 3 ether);
        assertTrue(multicall.aggregate3(_only(p.calls[1]))[0].success, "run later");
        assertEq(RECIPIENT.balance, 2 ether, "sent");
    }

    function _only(IMulticall3.Call3 memory c) internal pure returns (IMulticall3.Call3[] memory one) {
        one = new IMulticall3.Call3[](1);
        one[0] = c;
        one[0].allowFailure = false;
    }

    function test_b64url() public pure {
        assertTrue(keccak256(bytes(b64url(hex"fbff"))) == keccak256("-_8"), "url alphabet, no padding");
        assertTrue(keccak256(bytes(b64url("hello"))) == keccak256("aGVsbG8"), "hello");
    }
}
