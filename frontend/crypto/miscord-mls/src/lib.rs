use js_sys::Array;
use openmls::{
    credentials::{BasicCredential, CredentialWithKey},
    framing::{MlsMessageBodyIn, MlsMessageIn, MlsMessageOut, ProcessedMessageContent},
    group::{GroupId, MlsGroup, MlsGroupJoinConfig, StagedWelcome},
    key_packages::{KeyPackage, KeyPackageIn},
    prelude::{LeafNodeIndex, SignatureScheme},
    treesync::{LeafNodeParameters, RatchetTreeIn},
};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::{types::Ciphersuite, OpenMlsProvider};
use serde::{Deserialize as SerdeDeserialize, Serialize as SerdeSerialize};
use tls_codec::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

fn js_error(context: &str, error: impl std::fmt::Display) -> JsError {
    JsError::new(&format!("{context}: {error}"))
}

fn serialize_message(message: &MlsMessageOut) -> Result<Vec<u8>, JsError> {
    message
        .tls_serialize_detached()
        .map_err(|error| js_error("MLS message serialization failed", error))
}

fn parse_message(bytes: &[u8]) -> Result<MlsMessageBodyIn, JsError> {
    let mut cursor = bytes;
    MlsMessageIn::tls_deserialize(&mut cursor)
        .map_err(|error| js_error("MLS message decoding failed", error))
        .map(MlsMessageIn::extract)
}

#[wasm_bindgen]
#[derive(Default)]
pub struct Provider(OpenMlsRustCrypto);

impl AsRef<OpenMlsRustCrypto> for Provider {
    fn as_ref(&self) -> &OpenMlsRustCrypto {
        &self.0
    }
}

impl AsMut<OpenMlsRustCrypto> for Provider {
    fn as_mut(&mut self) -> &mut OpenMlsRustCrypto {
        &mut self.0
    }
}

#[wasm_bindgen]
impl Provider {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Provider {
        Provider::default()
    }

    pub fn export_state(&self) -> Result<Vec<u8>, JsError> {
        let values = self
            .0
            .storage()
            .values
            .read()
            .map_err(|_| JsError::new("MLS storage lock is poisoned"))?;
        let records: Vec<StorageRecord> = values
            .iter()
            .map(|(key, value)| StorageRecord {
                key: key.clone(),
                value: value.clone(),
            })
            .collect();
        serde_json::to_vec(&records).map_err(|error| js_error("MLS storage export failed", error))
    }

    pub fn import_state(bytes: &[u8]) -> Result<Provider, JsError> {
        let records: Vec<StorageRecord> = serde_json::from_slice(bytes)
            .map_err(|error| js_error("MLS storage import failed", error))?;
        let values = records
            .into_iter()
            .map(|record| (record.key, record.value))
            .collect();
        let provider = Provider::default();
        *provider
            .0
            .storage()
            .values
            .write()
            .map_err(|_| JsError::new("MLS storage lock is poisoned"))? = values;
        Ok(provider)
    }
}

#[derive(SerdeSerialize, SerdeDeserialize)]
struct StorageRecord {
    key: Vec<u8>,
    value: Vec<u8>,
}

#[wasm_bindgen]
pub struct Identity {
    credential: CredentialWithKey,
    signer: SignatureKeyPair,
}

#[derive(SerdeSerialize, SerdeDeserialize)]
struct IdentitySnapshot {
    credential: CredentialWithKey,
    signer: SignatureKeyPair,
}

#[wasm_bindgen]
impl Identity {
    #[wasm_bindgen(constructor)]
    pub fn new(provider: &Provider, credential_id: &str) -> Result<Identity, JsError> {
        if credential_id.is_empty() || credential_id.len() > 192 {
            return Err(JsError::new("Credential id must contain 1-192 bytes"));
        }
        let signer = SignatureKeyPair::new(SignatureScheme::ED25519)
            .map_err(|error| js_error("Identity key generation failed", error))?;
        signer
            .store(provider.0.storage())
            .map_err(|error| js_error("Identity key storage failed", error))?;
        let credential = CredentialWithKey {
            credential: BasicCredential::new(credential_id.as_bytes().to_vec()).into(),
            signature_key: signer.public().into(),
        };
        Ok(Identity { credential, signer })
    }

    pub fn key_package(&self, provider: &Provider) -> Result<Vec<u8>, JsError> {
        let package = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &provider.0,
                &self.signer,
                self.credential.clone(),
            )
            .map_err(|error| js_error("Key package generation failed", error))?;
        package
            .key_package()
            .tls_serialize_detached()
            .map_err(|error| js_error("Key package serialization failed", error))
    }

    pub fn signature_public_key(&self) -> Vec<u8> {
        self.signer.public().to_vec()
    }

    pub fn export_state(&self) -> Result<Vec<u8>, JsError> {
        serde_json::to_vec(&IdentitySnapshot {
            credential: self.credential.clone(),
            signer: self.signer.clone(),
        })
        .map_err(|error| js_error("MLS identity export failed", error))
    }

    pub fn import_state(provider: &Provider, bytes: &[u8]) -> Result<Identity, JsError> {
        let snapshot: IdentitySnapshot = serde_json::from_slice(bytes)
            .map_err(|error| js_error("MLS identity import failed", error))?;
        snapshot
            .signer
            .store(provider.0.storage())
            .map_err(|error| js_error("MLS identity key storage failed", error))?;
        Ok(Identity {
            credential: snapshot.credential,
            signer: snapshot.signer,
        })
    }
}

#[wasm_bindgen]
pub struct AddTransition {
    commit: Vec<u8>,
    welcome: Vec<u8>,
    ratchet_tree: Vec<u8>,
    epoch: u64,
}

#[wasm_bindgen]
impl AddTransition {
    #[wasm_bindgen(getter)]
    pub fn commit(&self) -> Vec<u8> {
        self.commit.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn welcome(&self) -> Vec<u8> {
        self.welcome.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn ratchet_tree(&self) -> Vec<u8> {
        self.ratchet_tree.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn epoch(&self) -> u64 {
        self.epoch
    }
}

#[wasm_bindgen]
pub struct RemoveTransition {
    commit: Vec<u8>,
    epoch: u64,
}

#[wasm_bindgen]
pub struct RotateTransition {
    commit: Vec<u8>,
    epoch: u64,
}

#[wasm_bindgen]
impl RotateTransition {
    #[wasm_bindgen(getter)]
    pub fn commit(&self) -> Vec<u8> {
        self.commit.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn epoch(&self) -> u64 {
        self.epoch
    }
}

#[wasm_bindgen]
impl RemoveTransition {
    #[wasm_bindgen(getter)]
    pub fn commit(&self) -> Vec<u8> {
        self.commit.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn epoch(&self) -> u64 {
        self.epoch
    }
}

#[wasm_bindgen]
pub struct Group {
    inner: MlsGroup,
}

#[wasm_bindgen]
impl Group {
    pub fn create(
        provider: &Provider,
        founder: &Identity,
        group_id: &[u8],
    ) -> Result<Group, JsError> {
        if group_id.is_empty() || group_id.len() > 128 {
            return Err(JsError::new("Group id must contain 1-128 bytes"));
        }
        let inner = MlsGroup::builder()
            .ciphersuite(CIPHERSUITE)
            .with_group_id(GroupId::from_slice(group_id))
            .build(&provider.0, &founder.signer, founder.credential.clone())
            .map_err(|error| js_error("MLS group creation failed", error))?;
        Ok(Group { inner })
    }

    pub fn join(
        provider: &Provider,
        welcome_bytes: &[u8],
        ratchet_tree_bytes: &[u8],
    ) -> Result<Group, JsError> {
        let welcome = match parse_message(welcome_bytes)? {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => return Err(JsError::new("Expected an MLS Welcome message")),
        };
        let mut tree_cursor = ratchet_tree_bytes;
        let ratchet_tree = RatchetTreeIn::tls_deserialize(&mut tree_cursor)
            .map_err(|error| js_error("Ratchet tree decoding failed", error))?;
        let config = MlsGroupJoinConfig::builder().build();
        let inner =
            StagedWelcome::new_from_welcome(&provider.0, &config, welcome, Some(ratchet_tree))
                .map_err(|error| js_error("MLS Welcome processing failed", error))?
                .into_group(&provider.0)
                .map_err(|error| js_error("MLS group join failed", error))?;
        Ok(Group { inner })
    }

    pub fn load(provider: &Provider, group_id: &[u8]) -> Result<Group, JsError> {
        let inner = MlsGroup::load(provider.0.storage(), &GroupId::from_slice(group_id))
            .map_err(|error| js_error("MLS group load failed", error))?
            .ok_or_else(|| JsError::new("MLS group was not found in local storage"))?;
        Ok(Group { inner })
    }

    pub fn encrypt_message(
        &mut self,
        provider: &Provider,
        sender: &Identity,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        if plaintext.is_empty() || plaintext.len() > 20_000 {
            return Err(JsError::new("MLS plaintext must contain 1-20000 bytes"));
        }
        let message = self
            .inner
            .create_message(&provider.0, &sender.signer, plaintext)
            .map_err(|error| js_error("MLS message encryption failed", error))?;
        serialize_message(&message)
    }

    pub fn decrypt_message(
        &mut self,
        provider: &mut Provider,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        let processed = match parse_message(ciphertext)? {
            MlsMessageBodyIn::PrivateMessage(message) => self
                .inner
                .process_message(provider.as_ref(), message)
                .map_err(|error| js_error("MLS message decryption failed", error))?,
            _ => {
                return Err(JsError::new(
                    "Expected an encrypted MLS application message",
                ))
            }
        };
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => Ok(message.into_bytes()),
            _ => Err(JsError::new("MLS message did not contain application data")),
        }
    }

    pub fn add_member(
        &mut self,
        provider: &mut Provider,
        sender: &Identity,
        key_package_bytes: &[u8],
    ) -> Result<AddTransition, JsError> {
        let mut cursor = key_package_bytes;
        let package_in = KeyPackageIn::tls_deserialize(&mut cursor)
            .map_err(|error| js_error("Key package decoding failed", error))?;
        let package = package_in
            .validate(
                provider.0.crypto(),
                openmls::prelude::ProtocolVersion::Mls10,
            )
            .map_err(|error| js_error("Key package validation failed", error))?;
        let (commit, welcome, _) = self
            .inner
            .add_members(&provider.0, &sender.signer, &[package])
            .map_err(|error| js_error("MLS member addition failed", error))?;
        let commit = serialize_message(&commit)?;
        let welcome = serialize_message(&welcome)?;
        self.inner
            .merge_pending_commit(provider.as_mut())
            .map_err(|error| js_error("MLS add commit merge failed", error))?;
        let ratchet_tree = self
            .inner
            .export_ratchet_tree()
            .tls_serialize_detached()
            .map_err(|error| js_error("Ratchet tree serialization failed", error))?;
        Ok(AddTransition {
            commit,
            welcome,
            ratchet_tree,
            epoch: self.inner.epoch().as_u64(),
        })
    }

    pub fn remove_member(
        &mut self,
        provider: &mut Provider,
        sender: &Identity,
        credential_id: &str,
    ) -> Result<RemoveTransition, JsError> {
        let target: LeafNodeIndex = self
            .inner
            .members()
            .find(|member| member.credential.serialized_content() == credential_id.as_bytes())
            .map(|member| member.index)
            .ok_or_else(|| JsError::new("MLS member was not found"))?;
        let (commit, _, _) = self
            .inner
            .remove_members(&provider.0, &sender.signer, &[target])
            .map_err(|error| js_error("MLS member removal failed", error))?;
        let commit = serialize_message(&commit)?;
        self.inner
            .merge_pending_commit(provider.as_mut())
            .map_err(|error| js_error("MLS remove commit merge failed", error))?;
        Ok(RemoveTransition {
            commit,
            epoch: self.inner.epoch().as_u64(),
        })
    }

    pub fn process_commit(
        &mut self,
        provider: &mut Provider,
        commit_bytes: &[u8],
    ) -> Result<(), JsError> {
        let processed = match parse_message(commit_bytes)? {
            MlsMessageBodyIn::PublicMessage(message) => self
                .inner
                .process_message(provider.as_ref(), message)
                .map_err(|error| js_error("MLS commit processing failed", error))?,
            MlsMessageBodyIn::PrivateMessage(message) => self
                .inner
                .process_message(provider.as_ref(), message)
                .map_err(|error| js_error("MLS commit processing failed", error))?,
            _ => return Err(JsError::new("Expected an MLS commit message")),
        };
        match processed.into_content() {
            ProcessedMessageContent::StagedCommitMessage(commit) => self
                .inner
                .merge_staged_commit(provider.as_mut(), *commit)
                .map_err(|error| js_error("MLS staged commit merge failed", error)),
            _ => Err(JsError::new("MLS message did not contain a staged commit")),
        }
    }

    pub fn rotate_epoch(
        &mut self,
        provider: &mut Provider,
        sender: &Identity,
    ) -> Result<RotateTransition, JsError> {
        let bundle = self
            .inner
            .self_update(&provider.0, &sender.signer, LeafNodeParameters::default())
            .map_err(|error| js_error("MLS epoch rotation failed", error))?;
        let (commit, _, _) = bundle.into_contents();
        let commit = serialize_message(&commit)?;
        self.inner
            .merge_pending_commit(provider.as_mut())
            .map_err(|error| js_error("MLS rotate commit merge failed", error))?;
        Ok(RotateTransition {
            commit,
            epoch: self.inner.epoch().as_u64(),
        })
    }

    pub fn export_key(
        &self,
        provider: &Provider,
        label: &str,
        context: &[u8],
        length: usize,
    ) -> Result<Vec<u8>, JsError> {
        if length == 0 || length > 64 {
            return Err(JsError::new("Exported key length must be 1-64 bytes"));
        }
        self.inner
            .export_secret(provider.0.crypto(), label, context, length)
            .map_err(|error| js_error("MLS key export failed", error))
    }

    pub fn roster(&self) -> Array {
        self.inner
            .members()
            .map(|member| {
                String::from_utf8_lossy(member.credential.serialized_content()).to_string()
            })
            .map(JsValue::from)
            .collect()
    }

    pub fn epoch(&self) -> u64 {
        self.inner.epoch().as_u64()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn members_share_exported_secrets_across_add_and_remove() {
        let mut alice_provider = Provider::new();
        let alice = Identity::new(&alice_provider, "alice:session-a").unwrap();
        let mut alice_group = Group::create(&alice_provider, &alice, b"voice-room-1").unwrap();

        let bob_provider = Provider::new();
        let bob = Identity::new(&bob_provider, "bob:session-b").unwrap();
        let add_bob = alice_group
            .add_member(
                &mut alice_provider,
                &alice,
                &bob.key_package(&bob_provider).unwrap(),
            )
            .unwrap();
        let bob_group =
            Group::join(&bob_provider, &add_bob.welcome, &add_bob.ratchet_tree).unwrap();
        assert_eq!(alice_group.epoch(), bob_group.epoch());
        assert_eq!(
            alice_group
                .export_key(&alice_provider, "miscord media", b"microphone", 16)
                .unwrap(),
            bob_group
                .export_key(&bob_provider, "miscord media", b"microphone", 16)
                .unwrap(),
        );

        let mut carol_provider = Provider::new();
        let carol = Identity::new(&carol_provider, "carol:session-c").unwrap();
        let add_carol = alice_group
            .add_member(
                &mut alice_provider,
                &alice,
                &carol.key_package(&carol_provider).unwrap(),
            )
            .unwrap();
        let mut carol_group =
            Group::join(&carol_provider, &add_carol.welcome, &add_carol.ratchet_tree).unwrap();
        let before_remove = carol_group
            .export_key(&carol_provider, "miscord media", b"screen-video", 16)
            .unwrap();

        let remove_bob = alice_group
            .remove_member(&mut alice_provider, &alice, "bob:session-b")
            .unwrap();
        carol_group
            .process_commit(&mut carol_provider, &remove_bob.commit)
            .unwrap();
        let after_remove = carol_group
            .export_key(&carol_provider, "miscord media", b"screen-video", 16)
            .unwrap();
        assert_ne!(before_remove, after_remove);
        assert_eq!(
            alice_group
                .export_key(&alice_provider, "miscord media", b"screen-video", 16)
                .unwrap(),
            after_remove,
        );

        let before_rotate = after_remove;
        let rotate = alice_group
            .rotate_epoch(&mut alice_provider, &alice)
            .unwrap();
        carol_group
            .process_commit(&mut carol_provider, &rotate.commit)
            .unwrap();
        let after_rotate = alice_group
            .export_key(&alice_provider, "miscord media", b"screen-video", 16)
            .unwrap();
        assert_ne!(before_rotate, after_rotate);
        assert_eq!(
            after_rotate,
            carol_group
                .export_key(&carol_provider, "miscord media", b"screen-video", 16)
                .unwrap(),
        );

        let encrypted = alice_group
            .encrypt_message(&alice_provider, &alice, b"secret hello")
            .unwrap();
        assert!(!encrypted
            .windows(12)
            .any(|window| window == b"secret hello"));
        assert_eq!(
            carol_group
                .decrypt_message(&mut carol_provider, &encrypted)
                .unwrap(),
            b"secret hello"
        );

        let storage = alice_provider.export_state().unwrap();
        let identity = alice.export_state().unwrap();
        let restored_provider = Provider::import_state(&storage).unwrap();
        let restored_identity = Identity::import_state(&restored_provider, &identity).unwrap();
        let restored_group = Group::load(&restored_provider, b"voice-room-1").unwrap();
        assert_eq!(restored_group.epoch(), alice_group.epoch());
        assert_eq!(
            restored_identity.signature_public_key(),
            alice.signature_public_key()
        );
    }
}
