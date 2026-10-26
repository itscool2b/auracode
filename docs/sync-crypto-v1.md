# Sync encryption wire contract v1

This document fixes client-side byte conventions for the opaque envelopes accepted by `/api/v1`.
It describes the protocol being implemented, not completed account/profile or sync acceptance.
Use reviewed RustCrypto and Dalek implementations, OS cryptographic randomness, and zeroizing
secret containers. No plaintext key, token, recovery key, record or config enters diagnostics.

All binary wire fields use canonical RFC 4648 URL-safe base64 without padding. JSON contexts below
are UTF-8 compact arrays with the listed order and no whitespace. Version integers use JSON numbers.
Account, device and record identifiers must satisfy the API's identifier restriction, so no separator
or Unicode normalization is implicit. The account key is 32 random bytes. Every encryption generates
a fresh 24-byte nonce and uses XChaCha20-Poly1305 with a 16-byte tag appended to ciphertext.

## Device envelope

Algorithm: `x25519-hkdf-sha256-xchacha20poly1305-v1`.
Generate a fresh ephemeral X25519 secret for every wrap, derive the shared secret with the recipient
device public key, and reject a non-contributory/all-zero shared secret. HKDF-SHA256 uses the ASCII
salt `auracode-hkdf-sha256-v1` and expands 32 bytes. Both HKDF info and AEAD AAD are:

`["auracode-device-key-v1", account_id, device_id, key_version, recipient_public_key, ephemeral_public_key]`

The plaintext is exactly the 32-byte account key. The recipient derives its own public key from its
private key; it does not accept a separate caller-supplied recipient key while unwrapping.

The matching six-digit approval code is the first four SHA256 bytes interpreted big-endian, modulo
1,000,000 and zero-padded to six digits, hashing:

`["auracode-device-approval-v1", account_id, device_id, public_key]`

Each client computes this from the actual key it displays or approves. The new device does not trust
the server's returned display code. Approval requires an explicit user comparison and expires after
600 seconds. Device names do not authenticate a public key.

The six-digit code authenticates the recipient public key, not the origin of a returned account-key
envelope. A malicious service knows that public key and could seal a different account key to it.
The first remotely approved device must therefore compare a second, locally computed account-key
fingerprint with the trusted approving device before its first sync. The server's `approved_at`
alone does not enable sync. The fingerprint is the first 16 bytes of:

`SHA256(compact_json(["auracode-account-key-fingerprint-v1", account_id, key_version]) || account_key_bytes)`

Display these 128 bits as eight groups of four uppercase hex digits. Compare all groups on the two
devices, then explicitly confirm locally. The trusted device derives this value from its retained
key, never an API-provided fingerprint. Initialization and recovery already know the key locally and
pin the returned envelope to that key. Reconnects reject any replacement of a confirmed key. Unknown
key-version changes require a future explicit rotation protocol and are currently refused.

This protects key acceptance from an active service substituting an envelope. It does not guarantee
availability: a malicious service can withhold ciphertext or approvals. Compromised endpoints or
someone confirming a mismatched fingerprint remain outside this protection.

## Retained-device session rebind

A fresh desktop sign-in does not inherit device approval from a matching public key. The server
issues a random 32-byte possession proof, sealed with algorithm
`x25519-hkdf-sha256-xchacha20poly1305-rebind-v1`. HKDF uses the same fixed salt; both info and AAD are:

`["auracode-device-rebind-v1", account_id, device_id, challenge_id, recipient_public_key, ephemeral_public_key]`

The client opens it with its retained private key and sends only the base64url proof to the verify
endpoint. This envelope has a distinct algorithm and purpose from account keys; the client refuses
to reveal an account-key envelope as a possession proof. The server consumes the challenge atomically
into that fresh desktop session, within five minutes, and checks expiry and revocation. Account keys
are neither sent to nor rewrapped by the server during rebind.

## Recovery envelope

The recovery key is 32 random bytes, displayed once as `aura-recovery-v1-` followed by base64url.
It never goes to the server. HKDF-SHA256 uses the same salt with independent info values:

- Encryption key: `["auracode-recovery-encryption-v1", account_id, key_version]`.
- Authentication proof: `["auracode-recovery-auth-v1", account_id, key_version]`.

Both outputs are 32 bytes. Algorithm `recovery-xchacha20poly1305-v1` encrypts the account key with
the derived encryption key and AAD `["auracode-recovery-key-v1", account_id, key_version]`.
`recovery_proof` is base64url of the derived proof. `recovery_verifier` is base64url of SHA256 of the
UTF-8 encoded proof string. Knowledge of the proof/verifier cannot derive the encryption key.

## Records and blobs

Record AAD authenticates the account and mutable routing metadata:

`["auracode-record-v1", account_id, collection, id, key_version, hlc, deleted]`

The encrypted payload contains its own `schema_version`; unknown newer versions remain untouched and
must not be written back by an older client. Tombstones retain an authenticated encrypted payload.
Blob AAD is `["auracode-blob-v1", account_id, id, key_version]`. Server ETags protect conditional
writes; they do not replace AEAD verification. The client never exposes data before verification.

Tests must reject cross-account, cross-device, cross-record, metadata and algorithm substitution;
wrong recovery keys; malformed encodings and lengths; low-order X25519 keys; and ciphertext/tag
tampering. Deterministic vectors use fixed test material only. Production APIs generate their own
ephemeral secrets and nonces.

The deterministic fixture is `crates/aura-sync/tests/fixtures/crypto-v1.json`. It uses only synthetic
material: account key `[1;32]`, device secret `[2;32]`, ephemeral secret `[3;32]`, nonce `[4;24]`,
recovery key `[5;32]`, account `account`, device `device`, and key version 1. It is a protocol regression
vector, not an independent audit of the underlying cryptographic libraries.
# Local secret storage

The desktop `aura-sync::vault` API addresses only `auracode.sync.v1` entries. Entry identities are
SHA256 of the compact JSON tuple `["auracode.sync.v1", canonical_https_origin, account_id]`, encoded
base64url without padding. An account's bounded 2048-byte secret bundle is replaced as one value.
Removing a session from that bundle must retain the keys needed for encrypted local data.

Native Windows storage uses Credential Manager with explicit `Local` persistence, never the
provider's default roaming persistence. macOS uses the user's login Keychain. The API does not search
or enumerate credentials, and the Windows provider's search feature is disabled. No provider error
payload is logged or passed to the UI. Native operations run on a blocking worker and are serialized
within the application process.

An explicit passphrase fallback is a separate store, never selected automatically after keychain
failure. Its file is in an existing auracode-owned private profile directory. Version 1 uses the
10-byte ASCII prefix `AURA-VAULT` followed by byte `01`, a 16-byte random salt, a 24-byte random nonce and
XChaCha20-Poly1305 ciphertext. Argon2id version 19 derives a 32-byte key with 65536 KiB, three passes
and one lane. Parameters are fixed by the format version, so files cannot request excessive KDF work.
AAD is compact JSON `["auracode-passphrase-vault-v1", entry_identity]`. Plaintext is byte `00` for an
empty store, or byte `01` followed by the bundle. A new nonce is generated for every replacement.
Passphrases must be 12 to 1024 UTF-8 bytes; the caller still needs guidance about choosing a strong
passphrase. The passphrase is never retained after deriving the unlocked key.

An exclusive lock is held while this fallback is open. Files are bounded before decryption and
replaced through a synced temporary file in the same directory. Unix files are owner-only and the
directory is synced after replacement. Windows metadata durability depends on the filesystem's
atomic rename/journaling guarantees. Existing files are never overwritten by `create`; corrupt or
unknown formats remain untouched. Unlock keys and loaded secret buffers are zeroized on drop.
Copies inside HTTP/OS libraries are outside this guarantee.

Sources: [keyring-core](https://docs.rs/keyring-core/latest/keyring_core/),
[Windows store](https://docs.rs/windows-native-keyring-store/latest/windows_native_keyring_store/),
[macOS store](https://docs.rs/apple-native-keyring-store/latest/apple_native_keyring_store/), and
[Argon2 key derivation](https://docs.rs/argon2/latest/argon2/).

## Local account database keys

The optional `aura-sync/sqlcipher` feature supplies a SQLCipher 4 keying primitive. A database key
is a separate 32-byte HKDF output from the account key, using the fixed salt above and compact JSON
info `["auracode-profile-database-v1", account_id, profile_id]`. It is never substituted for a record
key. `sqlite3_key` receives bytes directly; key material never enters SQL text or diagnostic errors.
Connections disable SQLCipher logging, enable its memory protection, and use in-memory temporary
storage before any application schema query. A schema read validates the key. An incorrect key and
a damaged encrypted header are intentionally the same error and must never trigger plaintext
recovery, migration, replacement, or an empty profile.

Every account connection and backup destination needs explicit keying. SQLCipher supports encrypted
to encrypted online backups, including `user_version`; opening a destination without its key is not
an encrypted backup. Keying an existing plaintext database does not convert it. Any future Local
import needs a separately reviewed explicit export path. Unkeyed Local connections remain ordinary
SQLite and require no sign-in. Profile opening, migration and recovery must enforce these rules in
core; this primitive alone does not make an account profile safe to use.

The pinned `libsqlite3-sys` 0.38.2 bundles SQLCipher 4.14.0. Windows builds use vendored OpenSSL;
macOS uses the platform CommonCrypto provider selected by its build script. MSVC OpenSSL builds need
native Perl. The local Windows qualification used official portable Strawberry Perl 5.42.3.1 in an
ignored build-tools directory, verified SHA256
`6a081a811781c30aca51dbc036afd93092af91e3297901f02c17043795a10690`, with only `OPENSSL_SRC_PERL`
set for the build process. No installer, global PATH change, or policy change was used. Missing debug
PDB warnings from the vendored OpenSSL static library do not affect the passing runtime tests.
macOS execution is still required before claiming platform qualification.

Sources: [SQLCipher API](https://www.zetetic.net/sqlcipher/sqlcipher-api/),
[encrypted online backup support](https://discuss.zetetic.net/t/using-the-sqlite-online-backup-api/2631/4),
and [OpenSSL Perl requirements](https://github.com/openssl/openssl/blob/master/NOTES-PERL.md).

