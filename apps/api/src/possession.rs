//! A retained-device proof, purpose-separated from every account-key envelope.
//! The plaintext here is a fresh random challenge. This service never receives account keys.
use crate::{
    crypto,
    policy::{ApiError, Result},
    types::KeyEnvelope,
};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use hkdf::Hkdf;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

pub fn seal(
    account: &str,
    device: &str,
    challenge: &str,
    recipient: &str,
) -> Result<(KeyEnvelope, Zeroizing<String>)> {
    let mut proof = Zeroizing::new([0; 32]);
    let mut ephemeral = Zeroizing::new([0; 32]);
    let mut nonce = [0; 24];
    getrandom::fill(proof.as_mut()).map_err(|_| ApiError::Unavailable)?;
    getrandom::fill(ephemeral.as_mut()).map_err(|_| ApiError::Unavailable)?;
    getrandom::fill(&mut nonce).map_err(|_| ApiError::Unavailable)?;
    let encoded = Zeroizing::new(crypto::encode(proof.as_ref()));
    let envelope = seal_with(
        account, device, challenge, recipient, ephemeral, proof, nonce,
    )?;
    Ok((envelope, encoded))
}

fn context(
    account: &str,
    device: &str,
    challenge: &str,
    recipient: &str,
    ephemeral: &str,
) -> Result<Vec<u8>> {
    serde_json::to_vec(&[
        "auracode-device-rebind-v1",
        account,
        device,
        challenge,
        recipient,
        ephemeral,
    ])
    .map_err(|_| ApiError::Unavailable)
}

fn seal_with(
    account: &str,
    device: &str,
    challenge: &str,
    recipient: &str,
    secret: Zeroizing<[u8; 32]>,
    proof: Zeroizing<[u8; 32]>,
    nonce: [u8; 24],
) -> Result<KeyEnvelope> {
    let public_bytes: [u8; 32] = crypto::decode(recipient, 32, 32)?
        .try_into()
        .map_err(|_| ApiError::InvalidRequest)?;
    let ephemeral = StaticSecret::from(*secret);
    let public = crypto::encode(PublicKey::from(&ephemeral).as_bytes());
    let shared = ephemeral.diffie_hellman(&PublicKey::from(public_bytes));
    if !shared.was_contributory() {
        return Err(ApiError::InvalidRequest);
    }
    let aad = context(account, device, challenge, recipient, &public)?;
    let mut key = Zeroizing::new([0; 32]);
    Hkdf::<Sha256>::new(Some(b"auracode-hkdf-sha256-v1"), shared.as_bytes())
        .expand(&aad, key.as_mut())
        .map_err(|_| ApiError::Unavailable)?;
    let cipher =
        XChaCha20Poly1305::new_from_slice(key.as_ref()).map_err(|_| ApiError::Unavailable)?;
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: proof.as_ref(),
                aad: &aad,
            },
        )
        .map_err(|_| ApiError::Unavailable)?;
    Ok(KeyEnvelope {
        algorithm: "x25519-hkdf-sha256-xchacha20poly1305-rebind-v1".into(),
        ciphertext: crypto::encode(&ciphertext),
        nonce: crypto::encode(&nonce),
        ephemeral_public_key: Some(public),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn possession_proof_is_bound_to_the_session_challenge_and_device() {
        let recipient = StaticSecret::from([3; 32]);
        let recipient_public = crypto::encode(PublicKey::from(&recipient).as_bytes());
        let envelope = seal_with(
            "account",
            "device",
            "challenge",
            &recipient_public,
            Zeroizing::new([5; 32]),
            Zeroizing::new([7; 32]),
            [9; 24],
        )
        .expect("seal");
        // Shared with the independently implemented desktop opener. Synthetic keys only.
        assert_eq!(
            recipient_public,
            "Xf7dO2vUf2-ijuFdlp1bsOpTd01Ii9r53xxuASSz7yI"
        );
        assert_eq!(
            envelope.ciphertext,
            "mNgCeLn249w8yCPoZAwkYJcOiFZ3cdMrhAyIMXuDa8zPpp5vvS6UFGDZ5ApNF0oK"
        );
        assert_eq!(envelope.nonce, "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJ");
        assert_eq!(
            envelope.ephemeral_public_key.as_deref(),
            Some("UKYUCbHd0DJemxa3AOcZ6XcsBwALG9d4bpB8ZT0gSV0")
        );
        let ephemeral = envelope.ephemeral_public_key.as_ref().expect("public");
        let remote: [u8; 32] = crypto::decode(ephemeral, 32, 32)
            .expect("decode")
            .try_into()
            .expect("key");
        let shared = recipient.diffie_hellman(&PublicKey::from(remote));
        for (account, device, challenge, valid) in [
            ("account", "device", "challenge", true),
            ("account", "device", "other", false),
            ("other", "device", "challenge", false),
            ("account", "other", "challenge", false),
        ] {
            let aad =
                context(account, device, challenge, &recipient_public, ephemeral).expect("aad");
            let mut key = [0; 32];
            Hkdf::<Sha256>::new(Some(b"auracode-hkdf-sha256-v1"), shared.as_bytes())
                .expand(&aad, &mut key)
                .expect("key");
            let cipher = XChaCha20Poly1305::new_from_slice(&key).expect("cipher");
            let ciphertext = crypto::decode(&envelope.ciphertext, 48, 48).expect("ciphertext");
            let opened = cipher.decrypt(
                XNonce::from_slice(&[9; 24]),
                Payload {
                    msg: &ciphertext,
                    aad: &aad,
                },
            );
            if valid {
                assert_eq!(opened.expect("proof"), [7; 32]);
            } else {
                assert!(opened.is_err());
            }
        }
    }
    #[test]
    fn low_order_recipient_keys_cannot_prove_device_possession() {
        assert!(seal("a", "d", "c", &crypto::encode(&[0; 32])).is_err());
        let mut low_order = [0; 32];
        low_order[0] = 1;
        assert!(seal("a", "d", "c", &crypto::encode(&low_order)).is_err());
    }
}
