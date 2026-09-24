//! API keys in the system keychain: Keychain Services on macOS and iOS, the
//! Credential Manager on Windows and the Secret Service on Linux. The window
//! reads and writes them with the commands below, which file every key under
//! the app's identifier, so a script in the window can reach no other entry.

use std::fs;
use std::path::Path;
use std::sync::Arc;

#[cfg(target_os = "macos")]
use apple_native_keyring_store::keychain::Store as SystemKeychain;
#[cfg(target_os = "ios")]
use apple_native_keyring_store::protected::Store as SystemKeychain;
#[cfg(windows)]
use windows_native_keyring_store::Store as SystemKeychain;
#[cfg(target_os = "linux")]
use zbus_secret_service_keyring_store::Store as SystemKeychain;

use keyring_core::{CredentialStore, Error};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_stronghold::stronghold::Stronghold;

// Versions before the app identifier became se.addablelabs.gaimer kept the
// OpenAI API key in a Stronghold vault in their app-data folder, encrypted
// with a key derived from a password and a salt that are in this repository.
const OLD_IDENTIFIER: &str = "com.gaimer.desktop";
const OLD_VAULT_FILE: &str = "credentials.stronghold";
const OLD_VAULT_PASSWORD: &[u8] = b"gaimer-credentials-vault";
const OLD_VAULT_SALT: &[u8] = b"gaimer-stronghold-salt";
const OLD_VAULT_CLIENT: &[u8] = b"credentials";

// The name the window gives the OpenAI API key, the only key that vault held
const OPENAI_API_KEY: &str = "openai:apiKey";

/// The key stored under `name`, or null when there is none
#[tauri::command]
pub async fn get_credential<R: Runtime>(
    app: AppHandle<R>,
    name: String,
) -> Result<Option<String>, String> {
    let service = app.config().identifier.clone();
    blocking(move || get(&*keychain()?, &service, &name)).await
}

/// Stores `value` under `name`, replacing any key stored there
#[tauri::command]
pub async fn set_credential<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    value: String,
) -> Result<(), String> {
    let service = app.config().identifier.clone();
    blocking(move || set(&*keychain()?, &service, &name, &value)).await
}

/// Deletes the key stored under `name`, if there is one
#[tauri::command]
pub async fn delete_credential<R: Runtime>(app: AppHandle<R>, name: String) -> Result<(), String> {
    let service = app.config().identifier.clone();
    blocking(move || delete(&*keychain()?, &service, &name)).await
}

/// Moves the OpenAI API key from the vault of versions before the identifier
/// change into the keychain, then deletes the vault. Once it is gone, this
/// does nothing.
#[tauri::command]
pub async fn import_old_vault<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let service = app.config().identifier.clone();
    let data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let vault = data_dir.with_file_name(OLD_IDENTIFIER).join(OLD_VAULT_FILE);
    blocking(move || import(&*keychain()?, &service, &vault)).await
}

/// The system keychain. On Linux this connects to the Secret Service, which
/// fails when none runs.
fn keychain() -> Result<Arc<CredentialStore>, String> {
    Ok(SystemKeychain::new().map_err(|err| err.to_string())?)
}

/// Runs a keychain call on a thread that may block: macOS can first ask the
/// user to allow access.
async fn blocking<T: Send + 'static>(
    call: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(call)
        .await
        .map_err(|err| err.to_string())?
}

fn get(keychain: &CredentialStore, service: &str, name: &str) -> Result<Option<String>, String> {
    let entry = keychain
        .build(service, name, None)
        .map_err(|err| err.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

fn set(keychain: &CredentialStore, service: &str, name: &str, value: &str) -> Result<(), String> {
    keychain
        .build(service, name, None)
        .and_then(|entry| entry.set_password(value))
        .map_err(|err| err.to_string())
}

fn delete(keychain: &CredentialStore, service: &str, name: &str) -> Result<(), String> {
    let entry = keychain
        .build(service, name, None)
        .map_err(|err| err.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

/// Moves the OpenAI API key from the old vault into the keychain, unless the
/// keychain has one already, and deletes the vault once the key is safe. A
/// vault that cannot be read stays, and so does the vault when the keychain
/// fails.
fn import(keychain: &CredentialStore, service: &str, vault: &Path) -> Result<(), String> {
    if !vault.exists() {
        return Ok(());
    }
    let not_moved = |err: String| {
        format!("Could not move the API key that an earlier version saved into the system keychain: {err}")
    };
    if get(keychain, service, OPENAI_API_KEY)
        .map_err(not_moved)?
        .is_none()
    {
        if let Some(key) = read_old_vault(vault)? {
            set(keychain, service, OPENAI_API_KEY, &key).map_err(not_moved)?;
        }
    }
    fs::remove_file(vault).map_err(|err| {
        format!(
            "Could not delete {}, where an earlier version saved the API key: {err}",
            vault.display()
        )
    })
}

/// The OpenAI API key in the old vault, if it holds one
fn read_old_vault(vault: &Path) -> Result<Option<String>, String> {
    let unreadable = |err: String| {
        format!(
            "Could not read the API key that an earlier version saved in {}: {err}",
            vault.display()
        )
    };
    let stronghold =
        Stronghold::new(vault, old_vault_key()?).map_err(|err| unreadable(err.to_string()))?;
    let client = stronghold
        .load_client(OLD_VAULT_CLIENT)
        .map_err(|err| unreadable(err.to_string()))?;
    let key = client
        .store()
        .get(OPENAI_API_KEY.as_bytes())
        .map_err(|err| unreadable(err.to_string()))?;
    key.map(String::from_utf8)
        .transpose()
        .map_err(|err| unreadable(err.to_string()))
}

/// The key the old vault is encrypted with: its password, hashed as those
/// versions hashed it
fn old_vault_key() -> Result<Vec<u8>, String> {
    let config = argon2::Config {
        lanes: 4,
        mem_cost: 10_000,
        time_cost: 10,
        variant: argon2::Variant::Argon2id,
        version: argon2::Version::Version13,
        ..Default::default()
    };
    argon2::hash_raw(OLD_VAULT_PASSWORD, OLD_VAULT_SALT, &config).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use keyring_core::mock;
    use std::path::PathBuf;
    use tempfile::TempDir;

    const SERVICE: &str = "se.addablelabs.gaimer";

    /// Where the old vault would be, in a folder deleted after the test
    fn old_vault_path() -> (TempDir, PathBuf) {
        let folder = tempfile::tempdir().unwrap();
        let vault = folder.path().join(OLD_VAULT_FILE);
        (folder, vault)
    }

    /// Writes a vault the way versions before the identifier change did: the
    /// window loaded it with this password, lib.rs hashed that with this salt
    /// and these settings, and the window stored the key in the store of the
    /// client "credentials" under "openai:apiKey"
    fn write_old_vault(vault: &Path, api_key: &str) {
        let config = argon2::Config {
            lanes: 4,
            mem_cost: 10_000,
            time_cost: 10,
            variant: argon2::Variant::Argon2id,
            version: argon2::Version::Version13,
            ..Default::default()
        };
        let key = argon2::hash_raw(
            b"gaimer-credentials-vault",
            b"gaimer-stronghold-salt",
            &config,
        )
        .unwrap();
        let stronghold = Stronghold::new(vault, key).unwrap();
        let client = stronghold.create_client(b"credentials").unwrap();
        client
            .store()
            .insert(b"openai:apiKey".to_vec(), api_key.as_bytes().to_vec(), None)
            .unwrap();
        stronghold.save().unwrap();
    }

    /// Makes the keychain's next call on the OpenAI API key fail
    fn fail_next_call(keychain: &CredentialStore) {
        let entry = keychain.build(SERVICE, OPENAI_API_KEY, None).unwrap();
        let credential: &mock::Cred = entry.as_any().downcast_ref().unwrap();
        credential.set_error(Error::NoStorageAccess("locked".into()));
    }

    #[test]
    fn stores_reads_and_deletes_a_key() {
        let keychain = mock::Store::new().unwrap();
        assert_eq!(get(&*keychain, SERVICE, OPENAI_API_KEY), Ok(None));

        set(&*keychain, SERVICE, OPENAI_API_KEY, "sk-new").unwrap();
        assert_eq!(
            get(&*keychain, SERVICE, OPENAI_API_KEY),
            Ok(Some("sk-new".into()))
        );

        delete(&*keychain, SERVICE, OPENAI_API_KEY).unwrap();
        assert_eq!(get(&*keychain, SERVICE, OPENAI_API_KEY), Ok(None));
        assert_eq!(delete(&*keychain, SERVICE, OPENAI_API_KEY), Ok(()));
    }

    #[test]
    fn passes_on_keychain_errors() {
        let keychain = mock::Store::new().unwrap();
        fail_next_call(&*keychain);
        let err = set(&*keychain, SERVICE, OPENAI_API_KEY, "sk-new").unwrap_err();
        assert!(err.contains("locked"), "{err}");
        assert_eq!(get(&*keychain, SERVICE, OPENAI_API_KEY), Ok(None));
    }

    #[test]
    fn moves_the_key_from_the_old_vault_into_the_keychain() {
        let (_folder, vault) = old_vault_path();
        write_old_vault(&vault, "sk-old");
        let keychain = mock::Store::new().unwrap();

        import(&*keychain, SERVICE, &vault).unwrap();

        assert_eq!(
            get(&*keychain, SERVICE, OPENAI_API_KEY),
            Ok(Some("sk-old".into()))
        );
        assert!(!vault.exists());
    }

    #[test]
    fn keeps_the_key_the_keychain_has() {
        let (_folder, vault) = old_vault_path();
        write_old_vault(&vault, "sk-old");
        let keychain = mock::Store::new().unwrap();
        set(&*keychain, SERVICE, OPENAI_API_KEY, "sk-new").unwrap();

        import(&*keychain, SERVICE, &vault).unwrap();

        assert_eq!(
            get(&*keychain, SERVICE, OPENAI_API_KEY),
            Ok(Some("sk-new".into()))
        );
        assert!(!vault.exists());
    }

    #[test]
    fn does_nothing_without_an_old_vault() {
        let (_folder, vault) = old_vault_path();
        let keychain = mock::Store::new().unwrap();

        import(&*keychain, SERVICE, &vault).unwrap();

        assert_eq!(get(&*keychain, SERVICE, OPENAI_API_KEY), Ok(None));
    }

    #[test]
    fn keeps_the_old_vault_when_the_keychain_fails() {
        let (_folder, vault) = old_vault_path();
        write_old_vault(&vault, "sk-old");
        let keychain = mock::Store::new().unwrap();
        fail_next_call(&*keychain);

        assert!(import(&*keychain, SERVICE, &vault).is_err());

        assert!(vault.exists());
        import(&*keychain, SERVICE, &vault).unwrap();
        assert_eq!(
            get(&*keychain, SERVICE, OPENAI_API_KEY),
            Ok(Some("sk-old".into()))
        );
    }

    #[test]
    fn keeps_an_old_vault_it_cannot_read() {
        let (_folder, vault) = old_vault_path();
        fs::write(&vault, b"not a vault").unwrap();
        let keychain = mock::Store::new().unwrap();

        let err = import(&*keychain, SERVICE, &vault).unwrap_err();

        assert!(err.contains(&vault.display().to_string()), "{err}");
        assert!(vault.exists());
        assert_eq!(get(&*keychain, SERVICE, OPENAI_API_KEY), Ok(None));
    }
}
