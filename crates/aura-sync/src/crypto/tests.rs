use super::*;

#[test]
fn device_envelopes_bind_account_device_version_and_public_key() {
    let key = AccountKey::generate().unwrap();
    let device = DeviceKey::generate().unwrap();
    let envelope = wrap_device(&key, "account", "device", 1, &device.public_key()).unwrap();
    assert_eq!(
        unwrap_device(&envelope, &device, "account", "device", 1)
            .unwrap()
            .0,
        key.0
    );
    for (account, target, version) in [
        ("other", "device", 1),
        ("account", "other", 1),
        ("account", "device", 2),
    ] {
        assert!(matches!(
            unwrap_device(&envelope, &device, account, target, version),
            Err(CryptoError::Authentication)
        ));
    }
    assert!(
        unwrap_device(
            &envelope,
            &DeviceKey::generate().unwrap(),
            "account",
            "device",
            1
        )
        .is_err()
    );
    assert!(wrap_device(&key, "account", "device", 1, &encode(&[0; 32])).is_err());
    assert!(wrap_device(&key, "account", "device", 1, &encode(&[1; 1])).is_err());
    let mut tampered = envelope.clone();
    tampered.algorithm = RECOVERY_ALGORITHM.into();
    assert!(matches!(
        unwrap_device(&tampered, &device, "account", "device", 1),
        Err(CryptoError::Version)
    ));
    let mut tampered = envelope;
    tampered.ephemeral_public_key = Some(encode(&[0; 32]));
    assert!(matches!(
        unwrap_device(&tampered, &device, "account", "device", 1),
        Err(CryptoError::Invalid)
    ));
}

#[test]
fn recovery_proof_is_separate_and_wrong_keys_or_context_fail() {
    let key = AccountKey::generate().unwrap();
    let recovery = RecoveryKey::generate().unwrap();
    let restored = RecoveryKey::parse(&recovery.display_once()).unwrap();
    assert_eq!(recovery.0, restored.0);
    let envelope = wrap_recovery(&key, &recovery, "account", 1).unwrap();
    assert_eq!(
        unwrap_recovery(&envelope, &restored, "account", 1)
            .unwrap()
            .0,
        key.0
    );
    assert!(unwrap_recovery(&envelope, &RecoveryKey::generate().unwrap(), "account", 1).is_err());
    assert!(unwrap_recovery(&envelope, &recovery, "other", 1).is_err());
    assert!(unwrap_recovery(&envelope, &recovery, "account", 2).is_err());
    let proof = recovery.auth_proof("account", 1).unwrap();
    assert_ne!(proof.as_str(), encode(recovery.0.as_ref()));
    let encryption = derive(
        recovery.0.as_ref(),
        &json_context(&("auracode-recovery-encryption-v1", "account", 1)).unwrap(),
    )
    .unwrap();
    assert_ne!(proof.as_str(), encode(encryption.as_ref()));
    assert_eq!(
        recovery.verifier("account", 1).unwrap(),
        encode(&Sha256::digest(proof.as_bytes()))
    );
    assert!(!format!("{recovery:?} {key:?}").contains(proof.as_str()));
    assert!(RecoveryKey::parse(&format!("{}=", recovery.display_once().as_str())).is_err());
}

fn context() -> RecordContext<'static> {
    RecordContext {
        account: "account",
        collection: "chats",
        id: "chat",
        key_version: 1,
        hlc: "1793000000000:0000000001:device",
        deleted: false,
    }
}
#[test]
fn record_aad_authenticates_routing_clock_and_deletion() {
    let key = AccountKey::generate().unwrap();
    let sealed = seal_record(&key, &context(), b"private code").unwrap();
    assert_eq!(
        open_record(&key, &context(), &sealed).unwrap().as_slice(),
        b"private code"
    );
    for context in [
        RecordContext {
            account: "other",
            ..context()
        },
        RecordContext {
            id: "other",
            ..context()
        },
        RecordContext {
            collection: "projects",
            ..context()
        },
        RecordContext {
            key_version: 2,
            ..context()
        },
        RecordContext {
            hlc: "later",
            ..context()
        },
        RecordContext {
            deleted: true,
            ..context()
        },
    ] {
        assert!(matches!(
            open_record(&key, &context, &sealed),
            Err(CryptoError::Authentication)
        ));
    }
    assert!(open_blob(&key, "account", "chat", 1, &sealed).is_err());
    let mut bytes = decode(&sealed.ciphertext, 100).unwrap();
    bytes[0] ^= 1;
    let tampered = SealedPayload {
        ciphertext: encode(&bytes),
        ..sealed.clone()
    };
    assert!(open_record(&key, &context(), &tampered).is_err());
    let second = seal_record(&key, &context(), b"private code").unwrap();
    assert_ne!(sealed.nonce, second.nonce);
    assert_ne!(sealed.ciphertext, second.ciphertext);
    assert!(seal_record(&key, &context(), &vec![0; MAX_RECORD_PLAINTEXT + 1]).is_err());
}

#[test]
fn malformed_encodings_and_lengths_are_rejected_before_decryption() {
    let key = AccountKey::generate().unwrap();
    for sealed in [
        SealedPayload {
            nonce: "!".into(),
            ciphertext: encode(&[0; 16]),
        },
        SealedPayload {
            nonce: encode(&[0; 23]),
            ciphertext: encode(&[0; 16]),
        },
        SealedPayload {
            nonce: encode(&[0; 24]),
            ciphertext: encode(&[0; 15]),
        },
    ] {
        assert!(open_record(&key, &context(), &sealed).is_err());
    }
    assert!(
        seal_record(
            &key,
            &RecordContext {
                account: "a|b",
                ..context()
            },
            b"x"
        )
        .is_err()
    );
    assert!(
        seal_record(
            &key,
            &RecordContext {
                key_version: 0,
                ..context()
            },
            b"x"
        )
        .is_err()
    );
}

#[test]
fn approval_code_changes_when_any_identity_input_changes() {
    let device = DeviceKey(StaticSecret::from([2; 32]));
    let code = device.approval_code("account", "device").unwrap();
    assert_eq!(code.len(), 6);
    assert!(code.bytes().all(|byte| byte.is_ascii_digit()));
    assert_ne!(code, device.approval_code("other", "device").unwrap());
    assert_ne!(code, device.approval_code("account", "other").unwrap());
}

#[test]
fn deterministic_wire_vector() {
    let account = AccountKey(Zeroizing::new([1; 32]));
    let device = DeviceKey(StaticSecret::from([2; 32]));
    let recovery = RecoveryKey(Zeroizing::new([5; 32]));
    let envelope = wrap_device_with(
        &account,
        "account",
        "device",
        1,
        &device.public_key(),
        StaticSecret::from([3; 32]),
        [4; 24],
    )
    .unwrap();
    let vector = serde_json::json!({ "device_public_key":device.public_key(), "approval_code": device.approval_code("account", "device").unwrap(),
        "device_envelope":envelope, "recovery_proof":recovery.auth_proof("account",1).unwrap().as_str(), "recovery_verifier":recovery.verifier("account",1).unwrap() });
    let expected: serde_json::Value =
        serde_json::from_str(include_str!("../../tests/fixtures/crypto-v1.json")).unwrap();
    assert_eq!(vector, expected);
    assert_eq!(
        unwrap_device(&envelope, &device, "account", "device", 1)
            .unwrap()
            .0,
        account.0
    );
}
