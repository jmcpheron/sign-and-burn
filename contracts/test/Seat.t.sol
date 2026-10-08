// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.sol";
import {Wots} from "./Wots.sol";
import {Seat} from "../src/Seat.sol";
import {SeatFactory} from "../src/SeatFactory.sol";
import {MockSafe, MockCurveSigner} from "./Mocks.sol";

contract SeatTest is Base {
    event Approved(address indexed safe, bytes32 indexed safeTxHash, uint64 indexed n, bytes32 nextKey);
    event SeatCreated(address indexed curveSigner, uint32 indexed seatNumber, address seat, bytes32 firstKey);

    SeatFactory factory = new SeatFactory();
    MockCurveSigner signer = new MockCurveSigner();
    MockSafe safe = new MockSafe();
    Seat seat;
    bytes32 pub;

    function seedOf(uint64 n) internal pure returns (bytes32) {
        return sha256(abi.encodePacked("test seed", n));
    }

    function setUp() public {
        bytes32 first = Wots.keyFingerprint(
            sha256(abi.encodePacked("sign-and-burn/seed/v1", block.chainid, address(signer), uint32(3))), 0, seedOf(0)
        );
        seat = Seat(factory.createSeat(address(signer), 3, first));
        pub = seat.pubSeed();
        safe.addOwner(address(seat));
    }

    // A whole approval as the page makes it: both messages from the seat's own n, then both signatures.
    struct Call {
        address safe;
        bytes32 stx;
        bytes32 next;
        bytes32[67] oneTime;
        bytes curve;
    }

    function make(uint64 n, address safe_, bytes32 stx) internal view returns (Call memory c) {
        c.safe = safe_;
        c.stx = stx;
        c.next = Wots.keyFingerprint(pub, n + 1, seedOf(n + 1));
        bytes32 cc = sha256(abi.encodePacked("sign-and-burn/approve/v1", block.chainid, address(seat), safe_, n, stx));
        bytes32 m = sha256(abi.encodePacked("sign-and-burn/one-time/v1", cc, c.next));
        c.oneTime = Wots.sign(pub, n, seedOf(n), m);
        c.curve = abi.encode(cc);
    }

    function send(Call memory c) internal {
        seat.approve(c.safe, c.stx, c.next, c.oneTime, c.curve);
    }

    bytes32 constant STX = keccak256("a safe transaction");

    function test_approveBurnsAndVotes() public {
        Call memory c = make(0, address(safe), STX);
        vm.expectEmit(true, true, true, true, address(seat));
        emit Approved(address(safe), STX, 0, c.next);
        uint256 g = gasleft();
        send(c);
        emit log_named_uint("gas, one approval", g - gasleft());
        assertEq(seat.n(), 1, "n moved on");
        assertEq(seat.current(), c.next, "next key recorded");
        assertTrue(safe.approvedHashes(address(seat), STX), "the Safe has the vote");
        assertEq(seat.approvedIn(0), block.number, "where to find it");
    }

    function test_ladder() public {
        for (uint64 i; i < 4; ++i) {
            send(make(i, address(safe), keccak256(abi.encode(i))));
            assertEq(seat.n(), i + 1, "n");
            assertEq(seat.current(), Wots.keyFingerprint(pub, i + 1, seedOf(i + 1)), "current");
        }
    }

    function test_anyoneMaySend() public {
        Call memory c = make(0, address(safe), STX);
        vm.prank(address(0xBEEF));
        seat.approve(c.safe, c.stx, c.next, c.oneTime, c.curve);
        assertEq(seat.n(), 1, "sent by a stranger");
    }

    // ---- the attack table (KICKOFF.md)

    function test_replayOldApproval() public {
        Call memory c = make(0, address(safe), STX);
        send(c);
        vm.expectRevert(Seat.BadNextKey.selector); // the old next key is the current one now: refused first
        send(c);
    }

    function test_reuseSpentKeyOnNewTransaction() public {
        send(make(0, address(safe), STX));
        // key 0 again for another transaction, now that the seat is at n = 1. Its next key is key 1's,
        // which is the current one, so this is refused at the next-key check; with some other next key
        // it fails the one-time check, since n and current have both moved.
        Call memory c = make(0, address(safe), keccak256("another"));
        vm.expectRevert(Seat.BadNextKey.selector);
        send(c);
        c.next = sha256("some other next key");
        bytes32 cc = sha256(abi.encodePacked("sign-and-burn/approve/v1", block.chainid, address(seat), c.safe, uint64(0), c.stx));
        c.oneTime = Wots.sign(pub, 0, seedOf(0), sha256(abi.encodePacked("sign-and-burn/one-time/v1", cc, c.next)));
        c.curve = abi.encode(cc);
        vm.expectRevert(Seat.BadOneTimeSignature.selector);
        send(c);
    }

    function test_swapNextKey() public {
        Call memory c = make(0, address(safe), STX);
        c.next = Wots.keyFingerprint(pub, 1, sha256("the attacker's own seed"));
        vm.expectRevert(Seat.BadOneTimeSignature.selector);
        send(c);
    }

    function test_otherSafe() public {
        Call memory c = make(0, address(safe), STX);
        c.safe = address(new MockSafe());
        vm.expectRevert(Seat.BadOneTimeSignature.selector);
        send(c);
    }

    function test_otherChain() public {
        Call memory c = make(0, address(safe), STX);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(Seat.BadOneTimeSignature.selector);
        send(c);
    }

    function test_curveSignatureAlone() public {
        Call memory c = make(0, address(safe), STX);
        bytes32[67] memory none;
        c.oneTime = none;
        vm.expectRevert(Seat.BadOneTimeSignature.selector);
        send(c);
    }

    function test_oneTimeAlone() public {
        Call memory c = make(0, address(safe), STX);
        c.curve = abi.encode(bytes32(uint256(1)));
        vm.expectRevert(Seat.BadCurveSignature.selector);
        send(c);
    }

    function test_safeThatDoesNotKnowTheSeat_keyNotSpent() public {
        MockSafe other = new MockSafe();
        Call memory c = make(0, address(other), STX);
        vm.expectRevert(bytes("GS030"));
        send(c);
        assertEq(seat.n(), 0, "n unchanged");
        assertEq(seat.current(), Wots.keyFingerprint(pub, 0, seedOf(0)), "key unchanged");
    }

    function test_badNextKey() public {
        Call memory c = make(0, address(safe), STX);
        c.next = bytes32(0);
        vm.expectRevert(Seat.BadNextKey.selector);
        send(c);
        c.next = seat.current();
        vm.expectRevert(Seat.BadNextKey.selector);
        send(c);
    }

    function test_noKeyAfterTheLast() public {
        uint64 last = type(uint64).max;
        bytes32 key = Wots.keyFingerprint(pub, last, seedOf(last));
        vm.store(address(seat), bytes32(uint256(0)), key); // current
        vm.store(address(seat), bytes32(uint256(1)), bytes32(uint256(last))); // n
        Call memory c;
        c.safe = address(safe);
        c.stx = STX;
        c.next = sha256("a next key, which cannot be named: there is no key last + 1");
        bytes32 cc = sha256(abi.encodePacked("sign-and-burn/approve/v1", block.chainid, address(seat), c.safe, last, c.stx));
        c.oneTime = Wots.sign(pub, last, seedOf(last), sha256(abi.encodePacked("sign-and-burn/one-time/v1", cc, c.next)));
        c.curve = abi.encode(cc);
        vm.expectRevert(); // Panic(0x11): n + 1 overflows
        send(c);
    }

    // ---- the factory

    function test_factoryAddressAndEvent() public {
        bytes32 first = keccak256("first");
        address predicted = factory.seatAddress(address(signer), 9, first);
        vm.expectEmit(true, true, false, true, address(factory));
        emit SeatCreated(address(signer), 9, predicted, first);
        assertTrue(factory.createSeat(address(signer), 9, first) == predicted, "address known in advance");
        assertTrue(Seat(predicted).curveSigner() == address(signer), "signer");
        assertEq(Seat(predicted).current(), first, "first key");
        address[] memory mine = factory.seatsOf(address(signer));
        assertEq(mine.length, 2, "listed with the seat setUp made");
        assertTrue(mine[1] == predicted, "in order");
        vm.expectRevert();
        factory.createSeat(address(signer), 9, first); // the same seat twice
    }
}
