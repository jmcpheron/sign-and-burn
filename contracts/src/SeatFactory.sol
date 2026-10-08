// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Seat} from "./Seat.sol";

/// @notice Deploys seats with CREATE2, so a seat's address is known before it exists. Anyone may
/// create a seat for any passkey; one made with a first key that is not that passkey's own is a
/// seat nobody can sign for, and the page ignores it (it checks `firstKey` against its own).
contract SeatFactory {
    event SeatCreated(address indexed curveSigner, uint32 indexed seatNumber, address seat, bytes32 firstKey);

    // Every seat made for each passkey signer, in order. Public RPCs search logs only a few hundred
    // blocks at a time, so the page finds a passkey's seats here, with one call.
    mapping(address => address[]) private _seats;

    function createSeat(address curveSigner, uint32 seatNumber, bytes32 firstKey) external returns (address seat) {
        bytes32 salt = keccak256(abi.encode(curveSigner, seatNumber, firstKey));
        seat = address(new Seat{salt: salt}(curveSigner, seatNumber, firstKey));
        _seats[curveSigner].push(seat);
        emit SeatCreated(curveSigner, seatNumber, seat, firstKey);
    }

    /// @notice The seats made for this passkey signer, by anyone. A passkey can sign only for a seat
    /// whose first key is its own; the console checks that before it lets a signature out.
    function seatsOf(address curveSigner) external view returns (address[] memory) {
        return _seats[curveSigner];
    }

    /// @notice Where `createSeat` with these arguments puts the seat.
    function seatAddress(address curveSigner, uint32 seatNumber, bytes32 firstKey) external view returns (address) {
        bytes32 salt = keccak256(abi.encode(curveSigner, seatNumber, firstKey));
        bytes32 initHash = keccak256(abi.encodePacked(type(Seat).creationCode, abi.encode(curveSigner, seatNumber, firstKey)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initHash)))));
    }
}
