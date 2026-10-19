"""Verify fixed synthetic vectors independently of the JavaScript fixture.

Run: python3 tests/generation/studio-mac-vector.verify.py
Requires openssl. Does not read any owner key, approval, ledger or issuer state.
"""
import hashlib
import hmac
import json
import pathlib
import subprocess

vector = json.loads(pathlib.Path(__file__).with_name('studio-mac-vector.json').read_text())
key = bytes.fromhex(vector['keyHex'])
domain = b'blockcraft-studio-issuer-v1' + bytes([0x0a])
assert domain.hex() == vector['domainHex']
state = vector['stateCanonical'].encode('utf-8')
assert json.loads(state)['grantDigest'] == hashlib.sha256(vector['grantCanonical'].encode('utf-8')).hexdigest()
for prefix, expected in [(domain, vector['expectedMac']),
                         (b'blockcraft-studio-issuer-v1' + bytes([0x5c, 0x6e]), vector['backslashNMac'])]:
    message = prefix + state
    assert hmac.new(key, message, hashlib.sha256).hexdigest() == expected
    result = subprocess.check_output(['openssl', 'dgst', '-sha256', '-mac', 'HMAC',
                                      '-macopt', 'hexkey:' + key.hex()], input=message)
    assert result.decode().strip().split()[-1] == expected
assert vector['expectedMac'] != vector['backslashNMac']
message = domain + vector['attemptCanonical'].encode('utf-8')
assert hmac.new(key, message, hashlib.sha256).hexdigest() == vector['expectedAttemptMac']
result = subprocess.check_output(['openssl', 'dgst', '-sha256', '-mac', 'HMAC',
                                  '-macopt', 'hexkey:' + key.hex()], input=message)
assert result.decode().strip().split()[-1] == vector['expectedAttemptMac']
print('PASS: fixed LF and backslash+n vectors match Python HMAC and OpenSSL independently')
