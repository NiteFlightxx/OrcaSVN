//! A disk snapshot is usable only after comparing a fresh filesystem inventory.
use crate::SvnStatus;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const VERSION: u32 = 1;
const MAX_BYTES: u64 = 64 * 1024 * 1024;
const MAX_FILES: usize = 500_000;

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(super) struct Stamp {
    #[serde(rename = "k")]
    kind: u8,
    #[serde(rename = "s")]
    size: u64,
    #[serde(rename = "m")]
    modified: u128,
    #[serde(rename = "c")]
    changed: i128,
    #[serde(rename = "l", skip_serializing_if = "Option::is_none", default)]
    link: Option<PathBuf>,
}
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(super) struct Inventory {
    files: BTreeMap<String, Stamp>,
    configuration: BTreeMap<String, u64>,
}
impl Inventory {
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.files.len()
    }
}
fn configuration() -> io::Result<BTreeMap<String, u64>> {
    let mut directories = vec![PathBuf::from("/etc/subversion")];
    for variable in ["HOME", "USERPROFILE", "APPDATA"] {
        if let Some(home) = std::env::var_os(variable) {
            directories.push(PathBuf::from(&home).join(if variable == "APPDATA" {
                "Subversion"
            } else {
                ".subversion"
            }));
        }
    }
    let mut result = BTreeMap::new();
    let executable = super::executor::current_svn_executable().map_err(io::Error::other)?;
    result.insert(format!("executable:{}", executable.display()), 0);
    for directory in directories {
        for name in ["config", "servers"] {
            let path = directory.join(name);
            match fs::metadata(&path) {
                Ok(metadata) => {
                    if metadata.len() > 1024 * 1024 {
                        return Err(io::Error::other("SVN configuration too large"));
                    }
                    // Hash configuration; never persist potential credentials.
                    let hash = fs::read(&path)?
                        .iter()
                        .fold(0xcbf29ce484222325u64, |hash, byte| {
                            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
                        });
                    result.insert(path.to_string_lossy().into_owned(), hash);
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
    }
    Ok(result)
}

pub(super) fn capture(root: &Path) -> io::Result<Inventory> {
    let configuration = configuration()?;
    let mut result = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory)? {
            let path = entry?.path();
            let relative = path.strip_prefix(root).map_err(io::Error::other)?;
            let parts: Vec<_> = relative.components().collect();
            if let Some(index) = parts
                .iter()
                .position(|p| p.as_os_str() == ".svn" || p.as_os_str() == "_svn")
            {
                if parts
                    .get(index + 1)
                    .is_some_and(|p| p.as_os_str() == "pristine" || p.as_os_str() == "tmp")
                {
                    continue;
                }
            }
            let metadata = fs::symlink_metadata(&path)?;
            let directory = metadata.is_dir();
            let kind = if directory {
                0
            } else if metadata.is_file() {
                1
            } else if metadata.is_symlink() {
                2
            } else {
                return Err(io::Error::other("unsupported filesystem entry"));
            };
            // Directory mtimes change with children; compare their paths/types instead.
            #[cfg(unix)]
            let changed = {
                use std::os::unix::fs::MetadataExt;
                i128::from(metadata.ctime()) * 1_000_000_000 + i128::from(metadata.ctime_nsec())
            };
            #[cfg(not(unix))]
            let changed = 0;
            let stamp = Stamp {
                kind,
                size: if directory { 0 } else { metadata.len() },
                modified: if directory {
                    0
                } else {
                    metadata
                        .modified()?
                        .duration_since(UNIX_EPOCH)
                        .map_err(io::Error::other)?
                        .as_nanos()
                },
                changed: if directory { 0 } else { changed },
                link: if kind == 2 {
                    Some(fs::read_link(&path)?)
                } else {
                    None
                },
            };
            let key = relative
                .to_str()
                .ok_or_else(|| io::Error::other("non-UTF8 path"))?
                .replace('\\', "/");
            result.insert(key, stamp);
            if result.len() > MAX_FILES {
                return Err(io::Error::other("filesystem inventory too large"));
            }
            if directory {
                pending.push(path);
            }
        }
    }
    Ok(Inventory {
        files: result,
        configuration,
    })
}

/// None requests a full scan (SVN metadata or directory structure changed).
pub(super) fn differences(before: &Inventory, after: &Inventory) -> Option<Vec<String>> {
    if before.configuration != after.configuration {
        return None;
    }
    let before = &before.files;
    let after = &after.files;
    let mut old = before.iter().peekable();
    let mut new = after.iter().peekable();
    let mut paths = Vec::new();
    while old.peek().is_some() || new.peek().is_some() {
        let (path, previous, current) = match (old.peek(), new.peek()) {
            (Some((a, _)), Some((b, _))) if a == b => {
                let (path, previous) = old.next().unwrap();
                let (_, current) = new.next().unwrap();
                (path, Some(previous), Some(current))
            }
            (Some((a, _)), Some((b, _))) if a < b => {
                let (path, previous) = old.next().unwrap();
                (path, Some(previous), None)
            }
            (Some(_), None) => {
                let (path, previous) = old.next().unwrap();
                (path, Some(previous), None)
            }
            _ => {
                let (path, current) = new.next().unwrap();
                (path, None, Some(current))
            }
        };
        if previous == current {
            continue;
        }
        if path.split('/').any(|part| part == ".svn" || part == "_svn")
            || previous.is_some_and(|stamp| stamp.kind == 0)
            || current.is_some_and(|stamp| stamp.kind == 0)
        {
            return None;
        }
        paths.push(path.clone());
        if paths.len() > 256 {
            return None;
        }
    }
    Some(paths)
}

#[derive(Serialize, Deserialize)]
pub(super) struct Snapshot {
    version: u32,
    root: PathBuf,
    saved: u64,
    pub inventory: Inventory,
    pub entries: Vec<SvnStatus>,
}
fn location(directory: &Path, root: &Path) -> PathBuf {
    // Deterministic filename; the serialized root also guards hash collisions.
    let hash = root
        .to_string_lossy()
        .bytes()
        .fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
        });
    directory.join(format!("status-{hash:016x}.json"))
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub(super) fn read(directory: &Path, root: &Path) -> Option<Snapshot> {
    let path = location(directory, root);
    if fs::metadata(&path).ok()?.len() > MAX_BYTES {
        return None;
    }
    let snapshot: Snapshot = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    (snapshot.version == VERSION
        && snapshot.root == root
        && now().checked_sub(snapshot.saved)? < 24 * 60 * 60)
        .then_some(snapshot)
}
pub(super) fn write(
    directory: &Path,
    root: &Path,
    inventory: Inventory,
    entries: Vec<SvnStatus>,
) -> io::Result<()> {
    fs::create_dir_all(directory)?;
    let snapshot = Snapshot {
        version: VERSION,
        root: root.to_path_buf(),
        saved: now(),
        inventory,
        entries,
    };
    let bytes = serde_json::to_vec(&snapshot)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(io::Error::other("status snapshot too large"));
    }
    let path = location(directory, root);
    let temp = path.with_extension("tmp");
    fs::write(&temp, bytes)?;
    // On Windows rename cannot replace an existing file. Removing the old cache
    // is safe: interruption only causes a complete scan next time.
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temp, path)?;
    // Bound disk usage to five recent workspaces.
    let mut files: Vec<_> = fs::read_dir(directory)?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with("status-") && name.ends_with(".json"))
        })
        .collect();
    files.sort_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok());
    let remove = files.len().saturating_sub(5);
    for entry in files.into_iter().take(remove) {
        let _ = fs::remove_file(entry.path());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn inventory(count: usize) -> Inventory {
        Inventory {
            files: (0..count)
                .map(|index| {
                    (
                        format!("file-{index:03}"),
                        Stamp {
                            kind: 1,
                            size: 1,
                            modified: 1,
                            changed: 1,
                            link: None,
                        },
                    )
                })
                .collect(),
            configuration: BTreeMap::new(),
        }
    }
    #[test]
    fn configuration_change_and_large_scope_require_complete_scan() {
        let before = inventory(0);
        assert_eq!(differences(&before, &inventory(256)).unwrap().len(), 256);
        assert!(differences(&before, &inventory(257)).is_none());
        let mut changed_configuration = inventory(0);
        changed_configuration
            .configuration
            .insert("config".into(), 1);
        assert!(differences(&before, &changed_configuration).is_none());
    }
}
