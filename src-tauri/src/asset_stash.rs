//! Durable, byte-preserving stashes. Never remove working data before capture.
use crate::{
    svn,
    workflows::{self as w, Identity, Result},
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub path: String,
    pub status: String,
    pub directory: bool,
    pub size: u64,
    pub revision: u64,
    pub working: Option<String>,
    pub working_hash: Option<String>,
    pub base: Option<String>,
    pub base_hash: Option<String>,
    pub properties: BTreeMap<String, String>,
    pub base_properties: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub identity: Identity,
    pub phase: String,
    pub warning: Option<String>,
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub legacy: Option<serde_json::Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub path: String,
    pub status: String,
    pub directory: bool,
    pub size: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collision {
    pub path: String,
    pub current_hash: Option<String>,
}

fn store(root: &Path) -> PathBuf {
    root.join("stashes").join("v2")
}
fn check_space(root: &Path, needed: u64) -> Result<()> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let name: Vec<u16> = root.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut free = 0u64;
        // Only query capacity. File write errors remain authoritative on every platform.
        let ok = unsafe {
            windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
                name.as_ptr(),
                &mut free,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        if free < needed {
            return Err(format!(
                "Insufficient stash space: need at least {needed} bytes, available {free}"
            ));
        }
    }
    #[cfg(not(windows))]
    let _ = needed;
    Ok(())
}
fn directory(root: &Path, id: &str) -> Result<PathBuf> {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("Invalid stash ID".into());
    }
    Ok(store(root).join(id))
}
fn blob(dir: &Path, name: &str) -> Result<PathBuf> {
    if name.is_empty() || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("Invalid payload reference".into());
    }
    w::safe_child(dir, &format!("payload/{name}"))
}
pub fn hash_file(path: &Path) -> Result<String> {
    let mut source = fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let count = source.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub(crate) fn copy_file(source: &Path, target: &Path) -> Result<String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut input = fs::File::open(source).map_err(|e| format!("{}: {e}", source.display()))?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|e| format!("{}: {e}", target.display()))?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        output
            .write_all(&buffer[..count])
            .map_err(|e| e.to_string())?;
        hash.update(&buffer[..count]);
    }
    output.sync_all().map_err(|e| e.to_string())?;
    let digest = format!("{:x}", hash.finalize());
    if hash_file(target)? != digest {
        return Err("Snapshot verification failed".into());
    }
    Ok(digest)
}
fn parse_properties(xml: &str) -> Result<BTreeMap<String, String>> {
    let mut reader = Reader::from_str(xml);
    let mut key = None;
    let mut value = String::new();
    let mut encoded = false;
    let mut values = BTreeMap::new();
    loop {
        match reader.read_event() {
            Ok(Event::Empty(e)) if e.name().as_ref() == b"property" => {
                if let Some(name) = e
                    .try_get_attribute("name")
                    .ok()
                    .flatten()
                    .and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()))
                {
                    values.insert(name, String::new());
                }
            }
            Ok(Event::Start(e)) if e.name().as_ref() == b"property" => {
                let attr = |name| {
                    e.try_get_attribute(name)
                        .ok()
                        .flatten()
                        .and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()))
                };
                key = attr("name");
                encoded = attr("encoding").as_deref() == Some("base64");
                value.clear();
            }
            Ok(Event::Text(e)) if key.is_some() => {
                value.push_str(&e.unescape().map_err(|e| e.to_string())?)
            }
            Ok(Event::CData(e)) if key.is_some() => value.push_str(&String::from_utf8_lossy(&e)),
            Ok(Event::End(e)) if e.name().as_ref() == b"property" => {
                if let Some(name) = key.take() {
                    values.insert(
                        name,
                        if encoded {
                            value.split_whitespace().collect::<String>()
                        } else {
                            BASE64.encode(value.as_bytes())
                        },
                    );
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(e.to_string()),
            _ => {}
        }
    }
    Ok(values)
}
pub(crate) async fn properties(
    root: &str,
    path: &str,
    base: bool,
) -> Result<BTreeMap<String, String>> {
    let target = w::target(path);
    let args = if base {
        vec![
            "proplist",
            "--xml",
            "--verbose",
            "-r",
            "BASE",
            "--",
            &target,
        ]
    } else {
        vec!["proplist", "--xml", "--verbose", "--", &target]
    };
    parse_properties(&w::run(root, &args).await?)
}
async fn node_info(root: &str, path: &str) -> Result<crate::SvnInfo> {
    w::ensure_owned(root, path).await?;
    let xml = w::run(root, &["info", "--xml", "--", &w::target(path)]).await?;
    svn::parse_info_xml(&xml).map_err(|e| e.to_string())
}
async fn existing_properties(root: &str, path: &str) -> Result<Option<BTreeMap<String, String>>> {
    let xml = w::run(
        root,
        &[
            "status",
            "--xml",
            "--verbose",
            "--depth",
            "empty",
            "--",
            &w::target(path),
        ],
    )
    .await?;
    let status = svn::parse_status_xml(&xml).map_err(|e| e.to_string())?;
    if status.iter().any(|s| {
        [
            "normal",
            "modified",
            "added",
            "deleted",
            "missing",
            "replaced",
            "conflicted",
        ]
        .contains(&s.status_code.as_str())
    }) {
        Ok(Some(properties(root, path, false).await?))
    } else {
        Ok(None)
    }
}
async fn set_properties(
    root: &str,
    path: &str,
    desired: &BTreeMap<String, String>,
    temp: &Path,
) -> Result<()> {
    let current = properties(root, path, false).await?;
    let target = w::target(path);
    for key in current.keys().filter(|key| !desired.contains_key(*key)) {
        w::run(root, &["propdel", key, "--", &target]).await?;
    }
    for (key, value) in desired {
        if current.get(key) == Some(value) {
            continue;
        }
        let bytes = BASE64.decode(value).map_err(|e| e.to_string())?;
        let file = temp.join(format!("property-{}", w::id()));
        fs::write(&file, bytes).map_err(|e| e.to_string())?;
        let result = w::run(
            root,
            &[
                "propset",
                key,
                "--file",
                &file.to_string_lossy(),
                "--",
                &target,
            ],
        )
        .await;
        let _ = fs::remove_file(file);
        result?;
    }
    Ok(())
}

fn walk(root: &Path, relative: &str, output: &mut BTreeMap<String, Candidate>) -> Result<()> {
    let path = w::safe_child(root, relative)?;
    if path.is_dir() && (path.join(".svn").exists() || path.join(".git").exists()) {
        return Err(format!("Nested repository: {relative}"));
    }
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    output.insert(
        relative.to_string(),
        Candidate {
            path: relative.into(),
            status: "unversioned".into(),
            directory: metadata.is_dir(),
            size: if metadata.is_file() {
                metadata.len()
            } else {
                0
            },
        },
    );
    if metadata.is_dir() {
        for child in fs::read_dir(path).map_err(|e| e.to_string())? {
            let child = child.map_err(|e| e.to_string())?;
            let name = child
                .file_name()
                .into_string()
                .map_err(|_| "Non-Unicode file name")?;
            walk(root, &format!("{relative}/{name}"), output)?;
        }
    }
    Ok(())
}
fn selected_paths(info: &Identity, path: &str, files: &[String]) -> Result<Vec<String>> {
    let workspace = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let root = fs::canonicalize(&info.root).map_err(|e| e.to_string())?;
    let prefix = workspace
        .strip_prefix(&root)
        .map_err(|_| "Workspace is outside working copy")?;
    files
        .iter()
        .map(|file| {
            w::safe_child(&workspace, file)?;
            let relative = prefix.join(file).to_string_lossy().replace('\\', "/");
            w::safe_child(&root, &relative)?;
            Ok(relative)
        })
        .collect()
}
async fn candidates(info: &Identity, files: &[String]) -> Result<Vec<Candidate>> {
    let statuses = w::local_status(&info.root, false).await?;
    if statuses
        .iter()
        .any(|s| s.status_code == "conflicted" || s.prop_status == "conflicted" || s.switched)
    {
        return Err("Resolve conflicts and switched subtrees before creating a stash".into());
    }
    let mut result = BTreeMap::new();
    for selected in files {
        w::safe_child(Path::new(&info.root), selected)?;
        w::ensure_owned(&info.root, selected).await?;
        let matches: Vec<_> = statuses
            .iter()
            .filter(|s| s.path == *selected || s.path.starts_with(&format!("{selected}/")))
            .collect();
        if matches.is_empty() {
            return Err(format!("No changes found: {selected}"));
        }
        for entry in matches {
            if entry.history
                || ![
                    "modified",
                    "added",
                    "deleted",
                    "normal",
                    "none",
                    "unversioned",
                ]
                .contains(&entry.status_code.as_str())
            {
                return Err(format!(
                    "Unsupported stash state {}: {}",
                    entry.status_code, entry.path
                ));
            }
            let full = w::safe_child(Path::new(&info.root), &entry.path)?;
            if entry.status_code == "unversioned" {
                walk(Path::new(&info.root), &entry.path, &mut result)?;
            } else {
                let node = node_info(&info.root, &entry.path).await?;
                result.insert(
                    entry.path.clone(),
                    Candidate {
                        path: entry.path.clone(),
                        status: entry.status_code.clone(),
                        directory: node.node_kind == "dir",
                        size: fs::metadata(&full).map(|m| m.len()).unwrap_or(0),
                    },
                );
            }
        }
    }
    // A directory deletion/addition is indivisible. Reject partial child selection.
    for entry in &statuses {
        if ["added", "deleted"].contains(&entry.status_code.as_str())
            && result
                .keys()
                .any(|p| p.starts_with(&format!("{}/", entry.path)))
            && !result.contains_key(&entry.path)
        {
            return Err(format!(
                "Select the parent operation as well: {}",
                entry.path
            ));
        }
    }
    Ok(result.into_values().collect())
}
#[tauri::command]
pub async fn asset_stash_candidates(path: String, files: Vec<String>) -> Result<Vec<Candidate>> {
    let info = w::identity(&path).await?;
    candidates(&info, &selected_paths(&info, &path, &files)?).await
}

fn save(dir: &Path, manifest: &Manifest) -> Result<()> {
    w::atomic_json(&dir.join("manifest.json"), manifest)
}
pub fn read(root: &Path, id: &str) -> Result<Manifest> {
    let manifest: Manifest = serde_json::from_slice(
        &fs::read(directory(root, id)?.join("manifest.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if manifest.version != 2 || manifest.id != id {
        return Err("Unsupported or inconsistent stash manifest".into());
    }
    Ok(manifest)
}
fn verify(dir: &Path, manifest: &Manifest) -> Result<()> {
    let mut paths = BTreeSet::new();
    for node in &manifest.nodes {
        w::safe_child(dir, &node.path)?;
        if !paths.insert(&node.path) {
            return Err("Duplicate stash path".into());
        }
        for (name, expected) in [
            (&node.working, &node.working_hash),
            (&node.base, &node.base_hash),
        ] {
            if let Some(name) = name {
                if Some(hash_file(&blob(dir, name)?)?) != *expected {
                    return Err(format!("Damaged stash data: {}", node.path));
                }
            }
        }
    }
    Ok(())
}

pub async fn create(
    data: &Path,
    path: &str,
    name: &str,
    files: &[String],
    expected_url: &str,
) -> Result<Manifest> {
    let info = w::identity(path).await?;
    if info.url != expected_url {
        return Err("Working-copy branch changed".into());
    }
    let _guard = w::acquire(&info.root).await?;
    let files = selected_paths(&info, path, files)?;
    let selected = candidates(&info, &files).await?;
    if selected.is_empty() {
        return Err("Select files to stash".into());
    }
    let estimate = selected.iter().fold(1024u64 * 1024, |sum, n| {
        sum.saturating_add(n.size.saturating_mul(2))
    });
    check_space(&store(data), estimate)?;
    let mut manifest = Manifest {
        version: 2,
        id: w::id(),
        name: name.trim().to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        identity: info.clone(),
        phase: "capturing".into(),
        warning: None,
        nodes: Vec::new(),
        legacy: None,
    };
    let dir = directory(data, &manifest.id)?;
    fs::create_dir_all(dir.join("payload")).map_err(|e| e.to_string())?;
    save(&dir, &manifest)?;
    let total = selected.len();
    for (index, entry) in selected.into_iter().enumerate() {
        w::progress("capturing", &entry.path, index, total);
        let full = w::safe_child(Path::new(&info.root), &entry.path)?;
        let mut node = Node {
            path: entry.path,
            status: entry.status,
            directory: entry.directory,
            size: entry.size,
            revision: 0,
            working: None,
            working_hash: None,
            base: None,
            base_hash: None,
            properties: BTreeMap::new(),
            base_properties: BTreeMap::new(),
        };
        if node.status != "unversioned" {
            let node_info = node_info(&info.root, &node.path).await?;
            node.revision = node_info.revision;
            if node.status != "deleted" {
                node.properties = properties(&info.root, &node.path, false).await?;
            }
            if node.status != "added" {
                node.base_properties = properties(&info.root, &node.path, true).await?;
            }
            if node.properties.get("svn:mergeinfo") != node.base_properties.get("svn:mergeinfo") {
                return Err("Stash does not capture pending mergeinfo changes".into());
            }
        }
        if !node.directory {
            if node.status != "deleted" {
                let name = format!("{index}-working");
                node.working_hash = Some(copy_file(&full, &blob(&dir, &name)?)?);
                node.working = Some(name);
            }
            if !["unversioned", "added"].contains(&node.status.as_str()) {
                let name = format!("{index}-base");
                let base = blob(&dir, &name)?;
                w::run(
                    &info.root,
                    &[
                        "export",
                        "-r",
                        "BASE",
                        "--",
                        &w::target(&node.path),
                        &base.to_string_lossy(),
                    ],
                )
                .await?;
                fs::OpenOptions::new()
                    .write(true)
                    .open(&base)
                    .and_then(|f| f.sync_all())
                    .map_err(|e| e.to_string())?;
                node.base_hash = Some(hash_file(&base)?);
                node.base = Some(name);
            }
        }
        manifest.nodes.push(node);
        save(&dir, &manifest)?;
    }
    verify(&dir, &manifest)?;
    manifest.phase = "saved".into();
    save(&dir, &manifest)?;
    // Never clear a file that changed while its snapshot was being captured.
    let removal = remove_saved(&dir, &mut manifest, &files).await;
    if let Err(error) = removal {
        manifest.phase = "partial".into();
        manifest.warning = Some(error);
    } else {
        manifest.phase = "complete".into();
    }
    save(&dir, &manifest)?;
    Ok(manifest)
}
async fn remove_saved(dir: &Path, manifest: &mut Manifest, roots: &[String]) -> Result<()> {
    let info = manifest.identity.clone();
    if w::identity(&info.root).await? != info {
        return Err("Working-copy identity changed; snapshot retained".into());
    }
    let fresh = candidates(&info, roots).await?;
    if fresh.len() != manifest.nodes.len()
        || fresh.iter().any(|c| {
            !manifest
                .nodes
                .iter()
                .any(|n| n.path == c.path && n.status == c.status && n.directory == c.directory)
        })
    {
        return Err(
            "The selection changed during capture; snapshot retained without clearing new changes"
                .into(),
        );
    }
    for node in &manifest.nodes {
        let full = w::safe_child(Path::new(&info.root), &node.path)?;
        if let Some(hash) = &node.working_hash {
            if hash_file(&full)? != *hash {
                return Err(format!("Changed during capture: {}", node.path));
            }
        }
        if node.status != "unversioned"
            && node.status != "deleted"
            && properties(&info.root, &node.path, false).await? != node.properties
        {
            return Err(format!("Properties changed during capture: {}", node.path));
        }
    }
    manifest.phase = "removing".into();
    save(dir, manifest)?;
    // Only revert nodes captured above, including changes selected through a parent.
    for node in manifest.nodes.iter().filter(|n| n.status != "unversioned") {
        w::progress("removing", &node.path, 0, roots.len());
        {
            let depth = if node.directory && ["added", "deleted"].contains(&node.status.as_str()) {
                "infinity"
            } else {
                "empty"
            };
            w::run(
                &info.root,
                &["revert", "--depth", depth, "--", &w::target(&node.path)],
            )
            .await?;
        }
    }
    for node in manifest.nodes.iter().rev() {
        if !["added", "unversioned"].contains(&node.status.as_str()) {
            continue;
        }
        let full = w::safe_child(Path::new(&info.root), &node.path)?;
        if !full.exists() {
            continue;
        }
        if node.directory {
            fs::remove_dir(&full)
                .map_err(|e| format!("Directory not empty; retained {}: {e}", node.path))?;
        } else {
            if Some(hash_file(&full)?) != node.working_hash {
                return Err(format!("File changed; retained {}", node.path));
            }
            fs::remove_file(full).map_err(|e| e.to_string())?;
        }
        w::atomic_json(
            &dir.join("journal.json"),
            &serde_json::json!({"phase":"removing","lastPath":node.path}),
        )?;
    }
    Ok(())
}
#[tauri::command]
pub async fn asset_stash_create(
    app: tauri::AppHandle,
    path: String,
    name: String,
    files: Vec<String>,
    expected_url: String,
) -> Result<Manifest> {
    create(&w::data_dir(&app)?, &path, &name, &files, &expected_url).await
}
#[tauri::command]
pub async fn asset_stash_list(app: tauri::AppHandle, path: String) -> Result<Vec<Manifest>> {
    let identity = w::identity(&path).await?;
    let data = w::data_dir(&app)?;
    let root = store(&data);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().join("manifest.json").is_file() {
            let record = read(&data, &entry.file_name().to_string_lossy())?;
            let legacy_here = record.legacy.is_some()
                && fs::canonicalize(&record.identity.root).ok()
                    == fs::canonicalize(&identity.root).ok();
            if record.identity.uuid == identity.uuid || legacy_here {
                result.push(record);
            }
        }
    }
    result.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(result)
}
async fn validate_target(manifest: &Manifest, path: &str) -> Result<Identity> {
    let now = w::identity(path).await?;
    if now.uuid != manifest.identity.uuid || now.url != manifest.identity.url {
        return Err("Return to the stash source branch before restoring".into());
    }
    if manifest.phase == "capturing" {
        return Err("Capture is incomplete; original files were not cleared".into());
    }
    Ok(now)
}
pub async fn collisions(
    dir: &Path,
    manifest: &Manifest,
    info: &Identity,
) -> Result<Vec<Collision>> {
    verify(dir, manifest)?;
    let status = w::local_status(&info.root, true).await?;
    let mut result = Vec::new();
    for node in &manifest.nodes {
        w::ensure_owned(&info.root, &node.path).await?;
        let full = w::safe_child(Path::new(&info.root), &node.path)?;
        if full.is_dir() != node.directory && full.exists() {
            return Err(format!("Node kind changed: {}", node.path));
        }
        if node.directory {
            if full.exists() {
                let current = existing_properties(&info.root, &node.path)
                    .await?
                    .unwrap_or_default();
                if current != node.base_properties && current != node.properties {
                    result.push(Collision {
                        path: node.path.clone(),
                        current_hash: Some(w::digest(
                            &serde_json::to_vec(&current).map_err(|e| e.to_string())?,
                        )),
                    });
                }
            }
            continue;
        }
        let current_hash = if full.exists() {
            Some(hash_file(&full)?)
        } else {
            None
        };
        let current_props = if full.exists() {
            existing_properties(&info.root, &node.path)
                .await?
                .unwrap_or_default()
        } else {
            BTreeMap::new()
        };
        let already = current_hash == node.working_hash
            && (node.status == "unversioned" || current_props == node.properties);
        let baseline = current_hash == node.base_hash
            && (node.status == "unversioned"
                || node.status == "added"
                || current_props == node.base_properties);
        if !already && !baseline {
            result.push(Collision {
                path: node.path.clone(),
                current_hash: Some(w::digest(
                    &serde_json::to_vec(&(&current_hash, &current_props))
                        .map_err(|e| e.to_string())?,
                )),
            });
        }
    }
    for entry in status.iter().filter(|s| {
        s.history || s.switched || s.status_code == "conflicted" || s.prop_status == "conflicted"
    }) {
        if manifest
            .nodes
            .iter()
            .any(|n| n.path == entry.path || n.path.starts_with(&format!("{}/", entry.path)))
        {
            return Err(format!("Unsupported target state: {}", entry.path));
        }
    }
    for node in &manifest.nodes {
        let full = w::safe_child(Path::new(&info.root), &node.path)?;
        let xml = w::run(
            &info.root,
            &[
                "status",
                "--xml",
                "--verbose",
                "--depth",
                "empty",
                "--",
                &w::target(&node.path),
            ],
        )
        .await?;
        let exact = svn::parse_status_xml(&xml).map_err(|e| e.to_string())?;
        let state = exact
            .first()
            .map(|s| s.status_code.as_str())
            .unwrap_or("none");
        let compatible = match node.status.as_str() {
            "unversioned" => !full.exists() || state == "unversioned",
            "added" => !full.exists() || ["unversioned", "added"].contains(&state),
            "deleted" => ["normal", "none", "modified", "deleted", "missing"].contains(&state),
            _ => ["normal", "none", "modified"].contains(&state),
        };
        if !compatible {
            return Err(format!(
                "Target SVN schedule changed: {} ({state})",
                node.path
            ));
        }
    }
    Ok(result)
}
#[tauri::command]
pub async fn asset_stash_check(
    app: tauri::AppHandle,
    path: String,
    id: String,
) -> Result<Vec<Collision>> {
    let data = w::data_dir(&app)?;
    let manifest = read(&data, &id)?;
    if manifest.legacy.is_some() {
        let info = w::identity(&path).await?;
        w::clean_fingerprint(&info, false).await?;
        let (_, files) = legacy_data(&manifest, &info)?;
        crate::restore_unversioned_files(info.root, files, true).await?;
        return Ok(Vec::new());
    }
    let info = validate_target(&manifest, &path).await?;
    collisions(&directory(&data, &id)?, &manifest, &info).await
}
pub async fn apply(
    data: &Path,
    path: &str,
    id: &str,
    pop: bool,
    overwrite: &[Collision],
) -> Result<Manifest> {
    let dir = directory(data, id)?;
    let mut manifest = read(data, id)?;
    let _stash_guard = w::acquire_key(format!("stash:{}", dir.display()))?;
    if manifest.legacy.is_some() {
        return apply_legacy(&dir, manifest, path, pop).await;
    }
    let info = validate_target(&manifest, path).await?;
    let _guard = w::acquire(&info.root).await?;
    let pending = collisions(&dir, &manifest, &info).await?;
    if pending.iter().any(|c| {
        !overwrite
            .iter()
            .any(|d| d.path == c.path && d.current_hash == c.current_hash)
    }) {
        return Err(format!(
            "Review changed targets before overwriting: {}",
            pending
                .iter()
                .map(|c| c.path.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    let recovery = dir.join("recovery").join(w::id());
    fs::create_dir_all(&recovery).map_err(|e| e.to_string())?;
    // Back up every existing affected file before the first mutation, not only conflicts.
    let mut before = Vec::new();
    for (index, node) in manifest.nodes.iter().enumerate() {
        w::progress("restoring", &node.path, index, manifest.nodes.len());
        let full = w::safe_child(Path::new(&info.root), &node.path)?;
        let hash = if full.is_file() {
            Some(copy_file(&full, &recovery.join(index.to_string()))?)
        } else {
            None
        };
        let props = if full.exists() {
            existing_properties(&info.root, &node.path).await?
        } else {
            None
        };
        before.push((node.path.clone(), hash, props));
    }
    w::atomic_json(
        &recovery.join("manifest.json"),
        &serde_json::json!({"identity":info,"nodes":manifest.nodes,"before":before,"overwrite":overwrite}),
    )?;
    for (path, expected, props) in &before {
        let full = w::safe_child(Path::new(&info.root), path)?;
        let now = if full.is_file() {
            Some(hash_file(&full)?)
        } else {
            None
        };
        if now != *expected {
            return Err(format!("Target changed while backing up: {path}"));
        }
        if let Some(props) = props {
            if properties(&info.root, path, false).await? != *props {
                return Err(format!("Properties changed while backing up: {path}"));
            }
        }
    }
    let rechecked = collisions(&dir, &manifest, &info).await?;
    if serde_json::to_vec(&rechecked).map_err(|e| e.to_string())?
        != serde_json::to_vec(&pending).map_err(|e| e.to_string())?
    {
        return Err("Target changed during backup; review overwrite decisions again".into());
    }
    manifest.phase = "restoring".into();
    manifest.warning = None;
    save(&dir, &manifest)?;
    let result = restore(&dir, &manifest, &info).await;
    match result {
        Ok(()) => {
            manifest.phase = if pop { "popped" } else { "complete" }.into();
        }
        Err(error) => {
            manifest.phase = "partial".into();
            manifest.warning = Some(error);
        }
    }
    save(&dir, &manifest)?;
    Ok(manifest)
}
async fn restore(dir: &Path, manifest: &Manifest, info: &Identity) -> Result<()> {
    for (index, node) in manifest.nodes.iter().enumerate() {
        let full = w::safe_child(Path::new(&info.root), &node.path)?;
        if node.directory && node.status != "deleted" {
            fs::create_dir_all(&full).map_err(|e| e.to_string())?;
        }
        if let Some(name) = &node.working {
            // Stage beside the destination. Renaming avoids partially overwriting an asset.
            let parent = full.parent().ok_or("Missing file parent")?;
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            let temporary = parent.join(format!(".orcasvn-{}", w::id()));
            copy_file(&blob(dir, name)?, &temporary)?;
            if let Err(e) = fs::rename(&temporary, &full) {
                let _ = fs::remove_file(&temporary);
                return Err(format!(
                    "Cannot replace {} (close its editor): {e}",
                    node.path
                ));
            }
        }
        if node.status == "added" {
            let status = w::run(
                &info.root,
                &[
                    "status",
                    "--xml",
                    "--depth",
                    "empty",
                    "--",
                    &w::target(&node.path),
                ],
            )
            .await?;
            if svn::parse_status_xml(&status)
                .map_err(|e| e.to_string())?
                .iter()
                .any(|s| s.status_code == "unversioned")
            {
                w::run(
                    &info.root,
                    &["add", "--depth", "empty", "--", &w::target(&node.path)],
                )
                .await?;
            }
        }
        if node.status != "unversioned" && node.status != "deleted" {
            set_properties(&info.root, &node.path, &node.properties, dir).await?;
        }
        w::atomic_json(
            &dir.join("journal.json"),
            &serde_json::json!({"phase":"restoring","lastIndex":index,"lastPath":node.path}),
        )?;
    }
    for node in manifest
        .nodes
        .iter()
        .rev()
        .filter(|n| n.status == "deleted")
    {
        let statuses = w::run(
            &info.root,
            &[
                "status",
                "--xml",
                "--depth",
                "empty",
                "--",
                &w::target(&node.path),
            ],
        )
        .await?;
        if !svn::parse_status_xml(&statuses)
            .map_err(|e| e.to_string())?
            .iter()
            .any(|s| s.status_code == "deleted")
        {
            w::run(&info.root, &["delete", "--", &w::target(&node.path)]).await?;
        }
    }
    for node in &manifest.nodes {
        let full = w::safe_child(Path::new(&info.root), &node.path)?;
        if let Some(hash) = &node.working_hash {
            if hash_file(&full)? != *hash {
                return Err(format!("Restore verification failed: {}", node.path));
            }
        }
        if node.status == "deleted" && full.exists() {
            return Err(format!("Deletion verification failed: {}", node.path));
        }
        if node.status != "unversioned"
            && node.status != "deleted"
            && properties(&info.root, &node.path, false).await? != node.properties
        {
            return Err(format!("Property verification failed: {}", node.path));
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn asset_stash_apply(
    app: tauri::AppHandle,
    path: String,
    id: String,
    pop: bool,
    overwrite: Vec<Collision>,
) -> Result<Manifest> {
    apply(&w::data_dir(&app)?, &path, &id, pop, &overwrite).await
}
#[tauri::command]
pub fn asset_stash_delete(app: tauri::AppHandle, id: String) -> Result<()> {
    let data = w::data_dir(&app)?;
    let _guard = w::acquire_key(format!("stash:{}", directory(&data, &id)?.display()))?;
    let mut manifest = read(&data, &id)?;
    // Retain recovery materials. Explicit deletion removes the record from the active list.
    manifest.phase = "deleted".into();
    save(&directory(&data, &id)?, &manifest)
}
#[tauri::command]
pub fn asset_stash_export(
    app: tauri::AppHandle,
    id: String,
    destination: String,
) -> Result<String> {
    let data = w::data_dir(&app)?;
    let manifest = read(&data, &id)?;
    let source = directory(&data, &id)?;
    verify(&source, &manifest)?;
    let target = Path::new(&destination).join(format!("OrcaSVN-{id}"));
    fs::create_dir(&target).map_err(|e| e.to_string())?;
    fs::create_dir(target.join("payload")).map_err(|e| e.to_string())?;
    for node in &manifest.nodes {
        for name in [&node.working, &node.base].into_iter().flatten() {
            if !blob(&target, name)?.exists() {
                copy_file(&blob(&source, name)?, &blob(&target, name)?)?;
            }
        }
    }
    save(&target, &manifest)?;
    Ok(target.to_string_lossy().into_owned())
}
#[tauri::command]
pub fn asset_stash_import(app: tauri::AppHandle, source: String) -> Result<Manifest> {
    let source = fs::canonicalize(source).map_err(|e| e.to_string())?;
    let mut manifest: Manifest =
        serde_json::from_slice(&fs::read(source.join("manifest.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if manifest.version != 2 {
        return Err("Unsupported stash format".into());
    }
    verify(&source, &manifest)?;
    manifest.id = w::id();
    let target = directory(&w::data_dir(&app)?, &manifest.id)?;
    fs::create_dir_all(target.join("payload")).map_err(|e| e.to_string())?;
    for node in &manifest.nodes {
        for name in [&node.working, &node.base].into_iter().flatten() {
            if !blob(&target, name)?.exists() {
                copy_file(&blob(&source, name)?, &blob(&target, name)?)?;
            }
        }
    }
    verify(&target, &manifest)?;
    save(&target, &manifest)?;
    Ok(manifest)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    path: String,
    base: Option<String>,
    working: Option<String>,
    size: u64,
}
#[tauri::command]
pub fn asset_stash_preview(app: tauri::AppHandle, id: String, file: String) -> Result<Preview> {
    let data = w::data_dir(&app)?;
    let manifest = read(&data, &id)?;
    let dir = directory(&data, &id)?;
    let node = manifest
        .nodes
        .iter()
        .find(|n| n.path == file)
        .ok_or("File is not in this stash")?;
    let text = |name: &Option<String>| -> Result<Option<String>> {
        let Some(name) = name else {
            return Ok(None);
        };
        let path = blob(&dir, name)?;
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 512 * 1024 {
            return Ok(None);
        }
        let bytes = fs::read(path).map_err(|e| e.to_string())?;
        Ok(if bytes.contains(&0) {
            None
        } else {
            String::from_utf8(bytes).ok()
        })
    };
    Ok(Preview {
        path: file,
        base: text(&node.base)?,
        working: text(&node.working)?,
        size: node.size,
    })
}

pub fn migrate_legacy(data: &Path, records: Vec<serde_json::Value>) -> Result<Vec<String>> {
    let mut migrated = Vec::new();
    for record in records {
        let original_id = record
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or("Invalid legacy stash ID")?;
        let original_path = record
            .get("workspacePath")
            .and_then(|v| v.as_str())
            .ok_or("Missing legacy workspace")?;
        let id = format!("legacy-{}", w::digest(original_id.as_bytes()));
        let dir = directory(data, &id)?;
        if dir.join("manifest.json").exists() {
            if read(data, &id)?.legacy.as_ref() != Some(&record) {
                return Err("Legacy stash ID collision; original data retained".into());
            }
        } else {
            let manifest = Manifest { version: 2, id, name: record.get("name").and_then(|v| v.as_str()).unwrap_or("Legacy stash").into(), created_at: record.get("createdAt").and_then(|v| v.as_str()).unwrap_or("").into(), identity: Identity { root: original_path.into(), uuid: String::new(), url: String::new(), repository_root: String::new(), revision: 0, depth: String::new() }, phase: "complete".into(), warning: Some("Legacy record: source branch and base revisions were not recorded. Confirm the original branch before restoring.".into()), nodes: Vec::new(), legacy: Some(record.clone()) };
            save(&dir, &manifest)?;
            if read(data, &manifest.id)?.legacy.as_ref() != Some(&record) {
                return Err("Legacy migration verification failed".into());
            }
        }
        migrated.push(original_id.to_string());
    }
    Ok(migrated)
}
#[tauri::command]
pub fn asset_stash_migrate(
    app: tauri::AppHandle,
    records: Vec<serde_json::Value>,
) -> Result<Vec<String>> {
    migrate_legacy(&w::data_dir(&app)?, records)
}

fn legacy_data(
    manifest: &Manifest,
    info: &Identity,
) -> Result<(String, Vec<crate::StashUnversionedEntry>)> {
    let original = fs::canonicalize(&manifest.identity.root).map_err(|e| e.to_string())?;
    if original != fs::canonicalize(&info.root).map_err(|e| e.to_string())? {
        return Err("Legacy stash belongs to a different working-copy path".into());
    }
    let legacy = manifest.legacy.as_ref().ok_or("Missing legacy data")?;
    let patch = legacy
        .get("patch")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    for line in patch.lines() {
        for prefix in ["Index: ", "--- ", "+++ ", "Property changes on: "] {
            if let Some(value) = line.strip_prefix(prefix) {
                let path = value.split('\t').next().unwrap_or("");
                w::safe_child(Path::new(&info.root), path)?;
            }
        }
    }
    let files: Vec<crate::StashUnversionedEntry> = serde_json::from_value(
        legacy
            .get("unversionedFiles")
            .cloned()
            .unwrap_or(serde_json::json!([])),
    )
    .map_err(|e| e.to_string())?;
    for file in &files {
        w::safe_child(Path::new(&info.root), &file.path)?;
    }
    Ok((patch, files))
}
async fn apply_legacy(
    dir: &Path,
    mut manifest: Manifest,
    path: &str,
    pop: bool,
) -> Result<Manifest> {
    let info = w::identity(path).await?;
    let _guard = w::acquire(&info.root).await?;
    w::clean_fingerprint(&info, false).await?;
    let (patch, files) = legacy_data(&manifest, &info)?;
    crate::restore_unversioned_files(info.root.clone(), files.clone(), true).await?;
    // Preserve baseline files before applying a legacy patch whose original base is unknown.
    let recovery = dir.join("recovery").join(w::id());
    fs::create_dir_all(&recovery).map_err(|e| e.to_string())?;
    let mut baseline = Vec::new();
    for line in patch.lines().filter_map(|l| l.strip_prefix("Index: ")) {
        let full = w::safe_child(Path::new(&info.root), line)?;
        if full.is_file() {
            let index = baseline.len();
            let hash = copy_file(&full, &recovery.join(index.to_string()))?;
            baseline.push((line.to_string(), hash));
        }
    }
    w::atomic_json(
        &recovery.join("manifest.json"),
        &serde_json::json!({"identity":info,"files":baseline}),
    )?;
    manifest.phase = "restoring".into();
    save(dir, &manifest)?;
    let result: Result<()> = async {
        if !patch.trim().is_empty() {
            svn::apply_patch(&info.root, &patch, false)
                .await
                .map_err(|e| e.to_string())?;
        }
        crate::restore_unversioned_files_impl(info.root.clone(), files, false).await?;
        Ok(())
    }
    .await;
    match result {
        Ok(()) => {
            manifest.phase = if pop { "popped" } else { "complete" }.into();
            manifest.warning = None;
        }
        Err(e) => {
            manifest.phase = "partial".into();
            manifest.warning = Some(e);
        }
    }
    save(dir, &manifest)?;
    Ok(manifest)
}
