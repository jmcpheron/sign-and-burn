# Rebuild a Safe transaction hash from the fields shown on screen. The console never signs a digest
# it was handed: it hashes these fields itself, so a page, a wallet or a service that names another
# hash can't get it approved.
# Safe >= 1.3.0: the EIP-712 domain is {chainId, verifyingContract}, no name or version.
# Every change here must pass console/test/run.py. From PicoQuorum's console.
from keccak import keccak256

DOMAIN_TYPEHASH = keccak256(b"EIP712Domain(uint256 chainId,address verifyingContract)")
SAFE_TX_TYPEHASH = keccak256(b"SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,"
                             b"uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)")
ZERO = "0x0000000000000000000000000000000000000000"
CALL, DELEGATECALL = 0, 1

_domain_cache = {}


def _hex(h):
    return bytes.fromhex(h[2:] if h.startswith("0x") else h)


def _addr(a):
    b = _hex(a)
    if len(b) != 20:
        raise ValueError("address must be 20 bytes")
    return bytes(12) + b


def _u256(n):
    n = int(n)
    if n < 0 or n >> 256:
        raise ValueError("uint256 out of range")
    return n.to_bytes(32, "big")


def domain_separator(chain_id, safe):
    key = (int(chain_id), safe.lower())
    if key not in _domain_cache:
        _domain_cache[key] = keccak256(DOMAIN_TYPEHASH + _u256(chain_id) + _addr(safe))
    return _domain_cache[key]


def safe_tx_hash(chain_id, safe, to, value, data, operation, safe_tx_gas=0, base_gas=0, gas_price=0,
                 gas_token=ZERO, refund_receiver=ZERO, nonce=0):
    # data: bytes or a 0x hex string. operation: CALL (0) or DELEGATECALL (1).
    if isinstance(data, str):
        data = _hex(data)
    if operation not in (CALL, DELEGATECALL):
        raise ValueError("operation must be 0 or 1")
    struct = keccak256(SAFE_TX_TYPEHASH + _addr(to) + _u256(value) + keccak256(data) + _u256(operation)
                       + _u256(safe_tx_gas) + _u256(base_gas) + _u256(gas_price) + _addr(gas_token)
                       + _addr(refund_receiver) + _u256(nonce))
    return keccak256(b"\x19\x01" + domain_separator(chain_id, safe) + struct)


def verify_code(h):
    # The last 8 hex characters of the hash, lowercase as the Safe app shows them, for a phone call.
    return "".join("%02x" % b for b in h[-4:])
