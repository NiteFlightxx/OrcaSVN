//! Repository navigation and explicit, reviewable working-copy operations.
use crate::svn::{self, execute_svn};
use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::Emitter;
use tauri::Manager;

pub type Result<T> = std::result::Result<T, String>;
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
pub fn register_app(app: tauri::AppHandle) {
    let _ = APP.set(app);
}
pub fn progress(phase: &str, file: &str, current: usize, total: usize) {
    if let Some(app) = APP.get() {
        let _ = app.emit(
            "workflow-progress",
            serde_json::json!({"phase":phase,"file":file,"current":current,"total":total}),
        );
    }
}

pub async fn run(path: &str, args: &[&str]) -> Result<String> {
    execute_svn(args, Some(path))
        .await
        .map_err(|e| e.to_string())
}
/// Always inspect fresh state without crossing external working-copy boundaries.
pub async fn local_status(path: &str, verbose: bool) -> Result<Vec<crate::SvnStatus>> {
    let mut args = vec!["status", "--xml", "--ignore-externals"];
    if verbose {
        args.push("--verbose");
    }
    args.extend(["--", "."]);
    svn::parse_status_xml(&run(path, &args).await?).map_err(|e| e.to_string())
}

/// For absent/unversioned nodes, inspect the nearest versioned ancestor as well.
pub async fn ensure_owned(root: &str, relative: &str) -> Result<()> {
    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let full = safe_child(Path::new(root), relative)?;
    let mut next = full.as_path();
    loop {
        let rel = next.strip_prefix(root).map_err(|e| e.to_string())?;
        let rel = rel.to_string_lossy().replace('\\', "/");
        let rel = if rel.is_empty() { "." } else { &rel };
        if let Ok(xml) = run(root, &["info", "--xml", "--", &target(rel)]).await {
            let owner = field(&xml, "wcroot-abspath");
            if owner.is_empty()
                || fs::canonicalize(owner).map_err(|e| e.to_string())? != canonical_root
            {
                return Err(format!("External or nested working copy: {relative}"));
            }
            return Ok(());
        }
        if next == Path::new(root) {
            return Err("Cannot verify working-copy ownership".into());
        }
        next = next.parent().ok_or("Missing working-copy ancestor")?;
    }
}
pub fn field(xml: &str, tag: &str) -> String {
    let mut reader = Reader::from_str(xml);
    let mut active = false;
    let mut result = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.name().as_ref() == tag.as_bytes() => active = true,
            Ok(Event::Text(e)) if active => result.push_str(&e.unescape().unwrap_or_default()),
            Ok(Event::End(e)) if active && e.name().as_ref() == tag.as_bytes() => return result,
            Ok(Event::Eof) | Err(_) => return result,
            _ => {}
        }
    }
}
pub fn id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn target(path: &str) -> String {
    if path == "." {
        ".".into()
    } else {
        format!("{path}@")
    }
}
pub fn valid_url(value: &str) -> Result<url::Url> {
    let url = url::Url::parse(value).map_err(|e| e.to_string())?;
    if !["http", "https", "svn", "svn+ssh", "file"].contains(&url.scheme())
        || url.fragment().is_some()
        || url.query().is_some()
    {
        return Err("Unsupported repository URL".into());
    }
    if url.password().is_some() {
        return Err("Use SVN authentication storage, not passwords in URLs".into());
    }
    Ok(url)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub root: String,
    pub uuid: String,
    pub url: String,
    pub repository_root: String,
    pub revision: u64,
    pub depth: String,
}
pub async fn identity(path: &str) -> Result<Identity> {
    let xml = run(path, &["info", "--xml", "--", "."]).await?;
    let mut root = field(&xml, "wcroot-abspath");
    if root.is_empty() {
        return Err("A working copy is required".into());
    }
    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let at_root = fs::canonicalize(path).map_err(|e| e.to_string())? == canonical_root;
    root = crate::strip_verbatim_prefix(&canonical_root.to_string_lossy());
    let root_xml = if at_root {
        xml
    } else {
        run(&root, &["info", "--xml", "--", "."]).await?
    };
    let info = svn::parse_info_xml(&root_xml).map_err(|e| e.to_string())?;
    let uuid = field(&root_xml, "uuid");
    if uuid.is_empty() || info.url.is_empty() {
        return Err("Incomplete working-copy identity".into());
    }
    Ok(Identity {
        root,
        uuid,
        url: info.url,
        repository_root: info.repository_root,
        revision: info.revision,
        depth: field(&root_xml, "depth"),
    })
}
pub async fn remote(path: &str, url: &str) -> Result<(crate::SvnInfo, String)> {
    valid_url(url)?;
    let xml = run(path, &["info", "--xml", "--", &target(url)]).await?;
    let info = svn::parse_info_xml(&xml).map_err(|e| e.to_string())?;
    if info.node_kind != "dir" || info.url.is_empty() {
        return Err("Select a repository directory".into());
    }
    Ok((info, field(&xml, "uuid")))
}

static WRITERS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
pub struct Writer(String);
impl Drop for Writer {
    fn drop(&mut self) {
        if let Ok(mut active) = WRITERS.get_or_init(Default::default).lock() {
            active.remove(&self.0);
        }
    }
}
pub async fn acquire(path: &str) -> Result<Writer> {
    let info = identity(path).await?;
    #[cfg(windows)]
    let key = info.root.to_lowercase();
    #[cfg(not(windows))]
    let key = info.root;
    acquire_key(key)
}
pub fn acquire_key(key: String) -> Result<Writer> {
    let mut active = WRITERS
        .get_or_init(Default::default)
        .lock()
        .map_err(|e| e.to_string())?;
    if !active.insert(key.clone()) {
        return Err("Another write operation is running in this working copy".into());
    }
    Ok(Writer(key))
}
pub fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}
pub fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    use std::io::Write;
    fs::create_dir_all(path.parent().ok_or("Missing parent")?).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!("{}.tmp", id()));
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}
pub fn safe_child(root: &Path, relative: &str) -> Result<PathBuf> {
    use std::path::Component;
    if relative.is_empty()
        || relative.contains('\\')
        || relative.contains(':')
        || Path::new(relative).is_absolute()
    {
        return Err(format!("Invalid relative path: {relative}"));
    }
    let mut next = root.to_path_buf();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(name)
                if !name.to_string_lossy().eq_ignore_ascii_case(".svn")
                    && !name.to_string_lossy().eq_ignore_ascii_case(".git") =>
            {
                next.push(name)
            }
            _ => return Err(format!("Invalid target: {relative}")),
        }
        if let Ok(meta) = fs::symlink_metadata(&next) {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err(format!("Reparse points are not supported: {relative}"));
                }
            }
            if meta.file_type().is_symlink() {
                return Err(format!("Symbolic links are not supported: {relative}"));
            }
        }
    }
    Ok(next)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryEntry {
    pub name: String,
    pub url: String,
    pub kind: String,
}
#[tauri::command]
pub async fn repository_identity(path: String) -> Result<Identity> {
    identity(&path).await
}
#[tauri::command]
pub async fn repository_branch(path: String, url: String) -> Result<RepositoryEntry> {
    let current = identity(&path).await?;
    let (info, uuid) = remote(&current.root, &url).await?;
    if current.uuid != uuid {
        return Err("Different repository UUID".into());
    }
    Ok(RepositoryEntry {
        name: info
            .url
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or(&info.url)
            .into(),
        url: info.url,
        kind: "dir".into(),
    })
}
#[tauri::command]
pub async fn repository_list(path: String, url: String) -> Result<Vec<RepositoryEntry>> {
    let current = identity(&path).await?;
    let (info, uuid) = remote(&current.root, &url).await?;
    if current.uuid != uuid {
        return Err("Different repository UUID".into());
    }
    let peg = format!("{}@{}", info.url, info.revision);
    let xml = run(
        &current.root,
        &[
            "list",
            "--xml",
            "-r",
            &info.revision.to_string(),
            "--",
            &peg,
        ],
    )
    .await?;
    let mut reader = Reader::from_str(&xml);
    let mut kind = String::new();
    let mut name_active = false;
    let mut name = String::new();
    let mut entries = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.name().as_ref() == b"entry" => {
                kind = e
                    .try_get_attribute("kind")
                    .ok()
                    .flatten()
                    .and_then(|a| a.unescape_value().ok().map(|s| s.into_owned()))
                    .unwrap_or_default();
                name.clear();
            }
            Ok(Event::Start(e)) if e.name().as_ref() == b"name" => name_active = true,
            Ok(Event::Text(e)) if name_active => {
                name.push_str(&e.unescape().map_err(|e| e.to_string())?)
            }
            Ok(Event::End(e)) if e.name().as_ref() == b"name" => name_active = false,
            Ok(Event::End(e)) if e.name().as_ref() == b"entry" => {
                let mut child = valid_url(&info.url)?;
                child
                    .path_segments_mut()
                    .map_err(|_| "Invalid URL")?
                    .pop_if_empty()
                    .push(&name);
                entries.push(RepositoryEntry {
                    name: name.clone(),
                    url: child.to_string(),
                    kind: kind.clone(),
                });
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(e.to_string()),
            _ => {}
        }
    }
    Ok(entries)
}

pub async fn clean_fingerprint(info: &Identity, uniform: bool) -> Result<String> {
    let status = run(
        &info.root,
        &[
            "status",
            "--xml",
            "--verbose",
            "--ignore-externals",
            "--",
            ".",
        ],
    )
    .await?;
    let mut entries = svn::parse_status_xml(&status).map_err(|e| e.to_string())?;
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    let blocked: Vec<_> = entries
        .iter()
        .filter(|s| {
            s.switched
                || s.history
                || s.locked
                || !["normal", "none", "unversioned", "ignored", "external"]
                    .contains(&s.status_code.as_str())
                || ["modified", "conflicted"].contains(&s.prop_status.as_str())
        })
        .map(|s| s.path.as_str())
        .collect();
    if !blocked.is_empty() {
        return Err(format!(
            "Commit, stash or resolve these paths first:\n{}",
            blocked.join("\n")
        ));
    }
    if uniform {
        let xml = run(
            &info.root,
            &["info", "--xml", "--depth", "infinity", "--", "."],
        )
        .await?;
        let revisions = svn::parse_info_revisions_xml(&xml).map_err(|e| e.to_string())?;
        if revisions.iter().any(|(_, r)| *r != info.revision) {
            return Err("Update the working copy first (mixed revisions)".into());
        }
        if !info.depth.is_empty() && info.depth != "infinity" {
            return Err("Cherry-pick requires a full-depth working copy".into());
        }
        if xml.contains("<depth>empty</depth>")
            || xml.contains("<depth>files</depth>")
            || xml.contains("<depth>immediates</depth>")
            || xml.contains("<depth>exclude</depth>")
        {
            return Err("Cherry-pick requires a full-depth working copy".into());
        }
    }
    Ok(digest(
        &serde_json::to_vec(&(info, entries)).map_err(|e| e.to_string())?,
    ))
}

// Switch preserves local edits. Its preflight detects subsequent edits rather
// than requiring a clean tree; cherry-pick keeps its existing stricter policy.
fn canonical_xml_fingerprint(xml: &str) -> Result<String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut hash = Sha256::new();
    loop {
        let event = reader.read_event().map_err(|e| e.to_string())?;
        let empty = matches!(&event, Event::Empty(_));
        match event {
            Event::Start(e) | Event::Empty(e) => {
                let mut attributes = Vec::new();
                for attribute in e.attributes() {
                    let attribute = attribute.map_err(|e| e.to_string())?;
                    attributes.push((
                        String::from_utf8_lossy(attribute.key.as_ref()).into_owned(),
                        attribute
                            .unescape_value()
                            .map_err(|e| e.to_string())?
                            .into_owned(),
                    ));
                }
                attributes.sort();
                hash.update([if empty { 1 } else { 2 }]);
                hash.update(
                    serde_json::to_vec(&(String::from_utf8_lossy(e.name().as_ref()), attributes))
                        .map_err(|e| e.to_string())?,
                );
            }
            Event::End(e) => {
                hash.update([3]);
                hash.update(e.name().as_ref());
            }
            Event::Text(e) => {
                hash.update([4]);
                hash.update(
                    serde_json::to_vec(&e.unescape().map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?,
                );
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}

async fn switch_fingerprint(info: &Identity) -> Result<(String, Vec<String>)> {
    let xml = run(
        &info.root,
        &[
            "status",
            "--xml",
            "--verbose",
            "--ignore-externals",
            "--",
            ".",
        ],
    )
    .await?;
    let mut statuses = svn::parse_status_xml(&xml).map_err(|e| e.to_string())?;
    statuses.sort_by(|a, b| a.path.cmp(&b.path));
    let mut local_changes = Vec::new();
    let mut contents = Vec::new();
    for status in &statuses {
        if ["ignored", "external"].contains(&status.status_code.as_str())
            || (["normal", "none"].contains(&status.status_code.as_str())
                && !["modified", "conflicted"].contains(&status.prop_status.as_str()))
        {
            continue;
        }
        local_changes.push(status.path.clone());
        // Unversioned nodes are not overwritten by this non-forced switch.
        // Do not read nested repositories or traverse their directory contents.
        if status.status_code == "unversioned" {
            continue;
        }
        let full = if status.path == "." {
            PathBuf::from(&info.root)
        } else {
            safe_child(Path::new(&info.root), &status.path)?
        };
        if full.is_file() {
            contents.push((status.path.clone(), crate::asset_stash::hash_file(&full)?));
        }
    }
    let properties = run(&info.root, &["diff", "--properties-only", "--", "."]).await?;
    let mut administration = Vec::new();
    for name in ["wc.db", "wc.db-wal"] {
        match fs::metadata(Path::new(&info.root).join(".svn").join(name)) {
            Ok(meta) => administration.push((
                name,
                meta.len(),
                meta.modified()
                    .map_err(|e| e.to_string())?
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_nanos(),
            )),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok((
        digest(
            &serde_json::to_vec(&(
                info,
                canonical_xml_fingerprint(&xml)?,
                contents,
                properties,
                administration,
            ))
            .map_err(|e| e.to_string())?,
        ),
        local_changes,
    ))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub kind: String,
    pub identity: Identity,
    pub source: String,
    pub source_revision: u64,
    pub revision: u64,
    pub fingerprint: String,
    pub preview: String,
    pub created: i64,
    #[serde(default)]
    pub local_changes: Vec<String>,
}
static PLANS: OnceLock<Mutex<HashMap<String, Plan>>> = OnceLock::new();
fn save_plan(plan: Plan) -> Result<Plan> {
    let mut plans = PLANS
        .get_or_init(Default::default)
        .lock()
        .map_err(|e| e.to_string())?;
    plans.retain(|_, p| chrono::Utc::now().timestamp() - p.created < 900);
    if plans.len() >= 32 {
        return Err("Too many open operation previews".into());
    }
    plans.insert(plan.id.clone(), plan.clone());
    Ok(plan)
}
#[tauri::command]
pub async fn repository_preview(
    path: String,
    source: String,
    revision: Option<u64>,
) -> Result<Plan> {
    let info = identity(&path).await?;
    let _guard = acquire(&info.root).await?;
    let (fingerprint, local_changes) = if revision.is_some() {
        (clean_fingerprint(&info, true).await?, Vec::new())
    } else {
        switch_fingerprint(&info).await?
    };
    let (source_info, uuid) = remote(&info.root, &source).await?;
    if uuid != info.uuid {
        return Err("Different repository UUID".into());
    }
    if source_info.url == info.url {
        return Err("Source and current branch are identical".into());
    }
    let peg = format!("{}@{}", source_info.url, source_info.revision);
    let preview = if let Some(rev) = revision {
        if rev == 0 || rev > source_info.revision {
            return Err("Invalid revision".into());
        }
        let eligible = run(
            &info.root,
            &[
                "mergeinfo",
                "--show-revs",
                "eligible",
                "--depth",
                "infinity",
                "-r",
                &rev.to_string(),
                "--",
                &peg,
                ".",
            ],
        )
        .await?;
        if eligible.contains('*') {
            return Err("Partial subtree merge requires manual review".into());
        }
        if !eligible.lines().any(|l| l.trim() == format!("r{rev}")) {
            return Err("Revision is already merged or is not eligible for this target".into());
        }
        run(
            &info.root,
            &[
                "merge",
                "--dry-run",
                "--accept",
                "postpone",
                "-c",
                &rev.to_string(),
                "--",
                &peg,
                ".",
            ],
        )
        .await?
    } else {
        format!(
            "{}\n→ {} @ r{}",
            info.url, source_info.url, source_info.revision
        )
    };
    save_plan(Plan {
        id: id(),
        kind: if revision.is_some() {
            "cherry-pick"
        } else {
            "switch"
        }
        .into(),
        identity: info,
        source: source_info.url,
        source_revision: source_info.revision,
        revision: revision.unwrap_or(0),
        fingerprint,
        preview,
        created: chrono::Utc::now().timestamp(),
        local_changes,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub id: String,
    pub kind: String,
    pub root: String,
    pub output: String,
    pub error: Option<String>,
    pub conflicts: Vec<String>,
    pub identity: Option<Identity>,
    pub created: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Change {
    path: String,
    status: String,
    directory: bool,
    hash: Option<String>,
}
async fn changed_snapshot(path: &str) -> Result<(String, Vec<Change>)> {
    let mut statuses = local_status(path, false).await?;
    statuses.sort_by(|a, b| a.path.cmp(&b.path));
    let mut changes = Vec::new();
    for status in &statuses {
        if ["unversioned", "ignored", "external"].contains(&status.status_code.as_str()) {
            continue;
        }
        let full = if status.path == "." {
            PathBuf::from(path)
        } else {
            safe_child(Path::new(path), &status.path)?
        };
        changes.push(Change {
            path: status.path.clone(),
            status: status.status_code.clone(),
            directory: full.is_dir(),
            hash: if full.is_file() {
                Some(crate::asset_stash::hash_file(&full)?)
            } else {
                None
            },
        });
    }
    let props = run(path, &["diff", "--properties-only", "--", "."]).await?;
    let fingerprint =
        digest(&serde_json::to_vec(&(&statuses, &changes, props)).map_err(|e| e.to_string())?);
    Ok((fingerprint, changes))
}
pub async fn outcome(path: &str, kind: &str, result: Result<String>) -> Outcome {
    let (output, error) = match result {
        Ok(v) => (v, None),
        Err(e) => (String::new(), Some(e)),
    };
    let mut errors = error;
    let conflicts = match local_status(path, true).await {
        Ok(v) => {
            let switched: Vec<_> = v
                .iter()
                .filter(|s| s.switched)
                .map(|s| s.path.as_str())
                .collect();
            if !switched.is_empty() {
                errors = Some(format!(
                    "{}\nSwitched subtrees remain; inspect these paths:\n{}",
                    errors.unwrap_or_default(),
                    switched.join("\n")
                ));
            }
            v.into_iter()
                .filter(|s| s.status_code == "conflicted" || s.prop_status == "conflicted")
                .map(|s| s.path)
                .collect()
        }
        Err(e) => {
            errors = Some(format!(
                "{}\nStatus verification failed: {e}",
                errors.unwrap_or_default()
            ));
            Vec::new()
        }
    };
    Outcome {
        id: id(),
        kind: kind.into(),
        root: path.into(),
        output,
        error: errors,
        conflicts,
        identity: identity(path).await.ok(),
        created: chrono::Utc::now().timestamp(),
    }
}
#[tauri::command]
pub async fn repository_execute(app: tauri::AppHandle, plan_id: String) -> Result<Outcome> {
    execute_plan(&data_dir(&app)?, &plan_id).await
}
pub async fn execute_plan(data: &Path, plan_id: &str) -> Result<Outcome> {
    let plan = PLANS
        .get_or_init(Default::default)
        .lock()
        .map_err(|e| e.to_string())?
        .remove(plan_id)
        .ok_or("Preview expired; run preview again")?;
    let _guard = acquire(&plan.identity.root).await?;
    let now = identity(&plan.identity.root).await?;
    if chrono::Utc::now().timestamp() - plan.created > 900
        || now != plan.identity
        || (if plan.kind == "switch" {
            switch_fingerprint(&now).await?.0
        } else {
            clean_fingerprint(&now, true).await?
        }) != plan.fingerprint
    {
        return Err("Working copy changed; run preview again".into());
    }
    let journal = data.join("operations").join(format!("{}.json", plan.id));
    atomic_json(
        &journal,
        &serde_json::json!({"phase":"running", "plan":plan}),
    )?;
    progress(&plan.kind, &plan.source, 0, 0);
    let peg = format!("{}@{}", plan.source, plan.source_revision);
    let result = if plan.kind == "switch" {
        run(
            &now.root,
            &[
                "switch",
                "--accept",
                "postpone",
                "--ignore-externals",
                "-r",
                &plan.source_revision.to_string(),
                "--",
                &peg,
                ".",
            ],
        )
        .await
    } else {
        run(
            &now.root,
            &[
                "merge",
                "--accept",
                "postpone",
                "-c",
                &plan.revision.to_string(),
                "--",
                &peg,
                ".",
            ],
        )
        .await
    };
    let mut result = outcome(&now.root, &plan.kind, result).await;
    result.id = plan.id.clone();
    // Only cherry-pick supports automatic undo. A second full content snapshot
    // after switch cannot provide undo and needlessly rereads modified assets.
    let (after, after_error) = if plan.kind == "cherry-pick" {
        match changed_snapshot(&now.root).await {
            Ok(state) => (Some(state), None),
            Err(error) => (None, Some(error)),
        }
    } else {
        (None, None)
    };
    atomic_json(
        &journal,
        &serde_json::json!({"phase":"finished", "plan":plan,"result":result,"after":after,"afterError":after_error}),
    )?;
    Ok(result)
}
pub async fn undo(data: &Path, operation_id: &str) -> Result<Outcome> {
    if operation_id.is_empty()
        || !operation_id
            .bytes()
            .all(|b| b.is_ascii_digit() || b == b'-')
    {
        return Err("Invalid operation ID".into());
    }
    let file = data.join("operations").join(format!("{operation_id}.json"));
    let mut journal: serde_json::Value =
        serde_json::from_slice(&fs::read(&file).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let plan: Plan = serde_json::from_value(journal["plan"].clone()).map_err(|e| e.to_string())?;
    if plan.kind != "cherry-pick"
        || journal["phase"] != "finished"
        || !journal["result"]["error"].is_null()
    {
        return Err("This operation cannot be automatically undone".into());
    }
    let _guard = acquire(&plan.identity.root).await?;
    if identity(&plan.identity.root).await? != plan.identity {
        return Err("Working-copy identity changed".into());
    }
    let (expected, changes): (String, Vec<Change>) =
        serde_json::from_value(journal["after"].clone()).map_err(|_| {
            format!(
                "No verified recovery state is available: {}",
                journal["afterError"]
            )
        })?;
    if changed_snapshot(&plan.identity.root).await?.0 != expected {
        return Err(
            "The working copy has additional edits. Keep them and undo manually after review."
                .into(),
        );
    }
    let backup = data.join("recovery").join(id());
    fs::create_dir_all(&backup).map_err(|e| e.to_string())?;
    for (index, change) in changes.iter().enumerate() {
        if change.hash.is_some() {
            let full = safe_child(Path::new(&plan.identity.root), &change.path)?;
            fs::copy(full, backup.join(index.to_string())).map_err(|e| e.to_string())?;
        }
    }
    let conflict_backup = backup_conflicts(
        &plan.identity.root,
        &repository_conflicts(plan.identity.root.clone()).await?,
        &backup,
    )
    .await?;
    atomic_json(
        &backup.join("manifest.json"),
        &serde_json::json!({"operation":journal, "conflicts":conflict_backup}),
    )?;
    if changed_snapshot(&plan.identity.root).await?.0 != expected {
        return Err("Files changed during backup; nothing was reverted".into());
    }
    journal["phase"] = "undoing".into();
    atomic_json(&file, &journal)?;
    let result: Result<String> = async {
        let mut output = String::new();
        for change in &changes {
            let depth =
                if change.directory && ["added", "deleted"].contains(&change.status.as_str()) {
                    "infinity"
                } else {
                    "empty"
                };
            output.push_str(
                &run(
                    &plan.identity.root,
                    &["revert", "--depth", depth, "--", &target(&change.path)],
                )
                .await?,
            );
        }
        for change in changes.iter().rev().filter(|c| c.status == "added") {
            let full = safe_child(Path::new(&plan.identity.root), &change.path)?;
            if !full.exists() {
                continue;
            }
            if change.directory {
                fs::remove_dir(&full).map_err(|e| e.to_string())?;
            } else {
                if Some(crate::asset_stash::hash_file(&full)?) != change.hash {
                    return Err(format!("New file changed; retained {}", change.path));
                }
                fs::remove_file(full).map_err(|e| e.to_string())?;
            }
        }
        Ok(output)
    }
    .await;
    let result = outcome(&plan.identity.root, "undo", result).await;
    journal["phase"] = if result.error.is_none() {
        "undone"
    } else {
        "undo-partial"
    }
    .into();
    journal["undoResult"] = serde_json::to_value(&result).map_err(|e| e.to_string())?;
    atomic_json(&file, &journal)?;
    Ok(result)
}
#[tauri::command]
pub async fn repository_undo(app: tauri::AppHandle, operation_id: String) -> Result<Outcome> {
    undo(&data_dir(&app)?, &operation_id).await
}
#[tauri::command]
pub fn repository_activities(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>> {
    let dir = data_dir(&app)?.join("operations");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut records: Vec<_> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|s| s == "json"))
        .collect();
    records.sort_by_key(|e| std::cmp::Reverse(e.file_name()));
    Ok(records
        .into_iter()
        .take(50)
        .filter_map(|e| {
            fs::read(e.path())
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
        })
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub path: String,
    pub kind: String,
    pub details: String,
    pub versions: Vec<ConflictVersion>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictVersion {
    pub side: String,
    pub path: String,
    pub size: u64,
    pub text: Option<String>,
}
#[tauri::command]
pub async fn repository_conflicts(path: String) -> Result<Vec<Conflict>> {
    let info = identity(&path).await?;
    let mut result = Vec::new();
    for entry in local_status(&info.root, false).await? {
        if entry.status_code != "conflicted" && entry.prop_status != "conflicted" {
            continue;
        }
        let xml = run(&info.root, &["info", "--xml", "--", &target(&entry.path)]).await?;
        let kind = if xml.contains("tree-conflict") {
            "tree"
        } else if entry.prop_status == "conflicted" {
            "property"
        } else {
            "content"
        };
        let mut versions = Vec::new();
        for (side, tag) in [
            ("base", "prev-base-file"),
            ("local", "prev-wc-file"),
            ("incoming", "cur-base-file"),
            ("properties", "prop-file"),
        ] {
            let artifact = field(&xml, tag);
            if artifact.is_empty() {
                continue;
            }
            let full = PathBuf::from(&artifact);
            let full = if full.is_absolute() {
                full
            } else {
                Path::new(&info.root).join(full)
            };
            let full = fs::canonicalize(full).map_err(|e| e.to_string())?;
            let root = fs::canonicalize(&info.root).map_err(|e| e.to_string())?;
            let relative = full
                .strip_prefix(&root)
                .map_err(|_| "Conflict artifact outside working copy")?
                .to_string_lossy()
                .replace('\\', "/");
            safe_child(&root, &relative)?;
            let size = fs::metadata(&full).map_err(|e| e.to_string())?.len();
            let text = if size <= 512 * 1024 {
                fs::read(&full)
                    .ok()
                    .filter(|b| !b.contains(&0))
                    .and_then(|b| String::from_utf8(b).ok())
            } else {
                None
            };
            versions.push(ConflictVersion {
                side: side.into(),
                path: relative,
                size,
                text,
            });
        }
        let working = if entry.path == "." {
            PathBuf::from(&info.root)
        } else {
            safe_child(Path::new(&info.root), &entry.path)?
        };
        if working.is_file() {
            let size = fs::metadata(&working).map_err(|e| e.to_string())?.len();
            let text = if size <= 512 * 1024 {
                fs::read(&working)
                    .ok()
                    .filter(|b| !b.contains(&0))
                    .and_then(|b| String::from_utf8(b).ok())
            } else {
                None
            };
            versions.push(ConflictVersion {
                side: "working".into(),
                path: entry.path.clone(),
                size,
                text,
            });
        }
        result.push(Conflict {
            path: entry.path,
            kind: kind.into(),
            details: xml,
            versions,
        });
    }
    Ok(result)
}

async fn backup_conflicts(
    root: &str,
    conflicts: &[Conflict],
    recovery: &Path,
) -> Result<Vec<serde_json::Value>> {
    let mut records = Vec::new();
    for conflict in conflicts {
        let mut paths: Vec<_> = conflict.versions.iter().map(|v| v.path.clone()).collect();
        let prop_artifact = field(&conflict.details, "prop-file");
        if !prop_artifact.is_empty() {
            let full = PathBuf::from(&prop_artifact);
            let full = if full.is_absolute() {
                full
            } else {
                Path::new(root).join(full)
            };
            let full = fs::canonicalize(full).map_err(|e| e.to_string())?;
            let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
            paths.push(
                full.strip_prefix(canonical_root)
                    .map_err(|_| "Property conflict artifact outside working copy")?
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
        paths.sort();
        paths.dedup();
        for path in paths {
            let full = safe_child(Path::new(root), &path)?;
            let name = format!("conflict-{}", records.len());
            let hash = crate::asset_stash::copy_file(&full, &recovery.join(&name))?;
            records.push(serde_json::json!({"path":path,"backup":name,"hash":hash}));
        }
    }
    Ok(records)
}
#[tauri::command]
pub async fn repository_resolve(
    app: tauri::AppHandle,
    path: String,
    file: String,
    strategy: String,
    expected_url: String,
) -> Result<Outcome> {
    resolve(&data_dir(&app)?, &path, &file, &strategy, &expected_url).await
}
pub async fn resolve(
    data: &Path,
    path: &str,
    file: &str,
    strategy: &str,
    expected_url: &str,
) -> Result<Outcome> {
    let _guard = acquire(path).await?;
    let info = identity(path).await?;
    if info.url != expected_url {
        return Err("Working-copy branch changed".into());
    }
    if !["working", "mine-full", "theirs-full"].contains(&strategy) {
        return Err("Unsupported resolution strategy".into());
    }
    let current = repository_conflicts(info.root.clone())
        .await?
        .into_iter()
        .find(|c| c.path == file)
        .ok_or("Conflict no longer exists")?;
    if current.kind != "content" && strategy != "working" {
        return Err(
            "Resolve this tree/property conflict manually, then mark the working result resolved"
                .into(),
        );
    }
    let actual = if file == "." {
        PathBuf::from(&info.root)
    } else {
        safe_child(Path::new(&info.root), file)?
    };
    let recovery = data.join("recovery").join(id());
    fs::create_dir_all(&recovery).map_err(|e| e.to_string())?;
    if actual.is_file() {
        crate::asset_stash::copy_file(&actual, &recovery.join("working-file"))?;
    }
    let artifacts = backup_conflicts(&info.root, std::slice::from_ref(&current), &recovery).await?;
    let properties = match run(
        &info.root,
        &["proplist", "--xml", "--verbose", "--", &target(file)],
    )
    .await
    {
        Ok(xml) => Some(xml),
        Err(_) if current.kind == "tree" => None,
        Err(error) => return Err(error),
    };
    atomic_json(
        &recovery.join("manifest.json"),
        &serde_json::json!({"identity":info,"path":file,"strategy":strategy,"conflict":current,"artifacts":artifacts,"properties":properties}),
    )?;
    let result = run(
        &info.root,
        &[
            "resolve",
            "--accept",
            strategy,
            "--depth",
            "empty",
            "--",
            &target(file),
        ],
    )
    .await;
    Ok(outcome(&info.root, "resolve", result).await)
}

#[cfg(test)]
mod switch_fingerprint_tests {
    use super::canonical_xml_fingerprint;

    #[test]
    fn switch_status_xml_fingerprint_normalizes_attributes_but_detects_semantic_changes() {
        let first = r#"<status><entry path="a&amp;b"><wc-status item="modified" revision="5" props="none"/></entry></status>"#;
        let reordered = "<status>\n<entry path=\"a&#38;b\"><wc-status props=\"none\" revision=\"5\" item=\"modified\" /></entry>\n</status>";
        assert_eq!(
            canonical_xml_fingerprint(first).unwrap(),
            canonical_xml_fingerprint(reordered).unwrap()
        );
        assert_ne!(
            canonical_xml_fingerprint(first).unwrap(),
            canonical_xml_fingerprint(&first.replace("revision=\"5\"", "revision=\"6\"")).unwrap()
        );
    }
}
