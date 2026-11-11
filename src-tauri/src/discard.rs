//! Selection-scoped discard: preview, revalidate, then mutate exact targets.
use crate::{asset_stash as stash, svn, workflows as w};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub path: String,
    pub status: String,
    pub directory: bool,
    pub hash: Option<String>,
    pub properties: BTreeMap<String, String>,
    pub info: String,
    pub remove: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub id: String,
    pub nodes: Vec<Node>,
}
struct Plan {
    created: Instant,
    identity: w::Identity,
    workspace: String,
    workspace_prefix: String,
    expected_url: String,
    selected: Vec<String>,
    nodes: Vec<Node>,
}
static PLANS: OnceLock<Mutex<HashMap<String, Plan>>> = OnceLock::new();
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub completed_paths: Vec<String>,
    pub error: Option<String>,
    pub status: Option<StatusPatch>,
}
pub use crate::svn::StatusPatch;

fn child(root: &Path, relative: &str) -> w::Result<PathBuf> {
    if relative == "." {
        Ok(root.to_path_buf())
    } else {
        w::safe_child(root, relative)
    }
}
fn under(path: &str, parent: &str) -> bool {
    parent == "." || path.starts_with(&format!("{parent}/"))
}
fn walk(root: &Path, relative: &str, nodes: &mut BTreeMap<String, Node>) -> w::Result<()> {
    let full = child(root, relative)?;
    if full.is_dir() && (full.join(".svn").exists() || full.join(".git").exists()) {
        return Err(format!(
            "Nested repository must be handled separately: {relative}"
        ));
    }
    let meta = fs::symlink_metadata(&full).map_err(|e| e.to_string())?;
    if !meta.is_file() && !meta.is_dir() {
        return Err(format!("Unsupported file type: {relative}"));
    }
    nodes.insert(
        relative.into(),
        Node {
            path: relative.into(),
            status: "unversioned".into(),
            directory: meta.is_dir(),
            hash: if meta.is_file() {
                Some(stash::hash_file(&full)?)
            } else {
                None
            },
            properties: BTreeMap::new(),
            info: String::new(),
            remove: true,
        },
    );
    if meta.is_dir() {
        for entry in fs::read_dir(&full).map_err(|e| e.to_string())? {
            let name = entry
                .map_err(|e| e.to_string())?
                .file_name()
                .into_string()
                .map_err(|_| "Non-Unicode filename")?;
            walk(root, &format!("{relative}/{name}"), nodes)?;
        }
    }
    Ok(())
}
async fn status_batch(
    root: &str,
    paths: &[String],
    depth: &str,
) -> w::Result<Vec<crate::SvnStatus>> {
    let mut statuses = Vec::new();
    let mut next = 0;
    while next < paths.len() {
        let start = next;
        let mut bytes = 0;
        while next < paths.len() && (next == start || bytes + paths[next].len() < 8000) {
            bytes += paths[next].len() + 4;
            next += 1;
        }
        let mut args: Vec<String> = [
            "status",
            "--xml",
            "--verbose",
            "--ignore-externals",
            "--depth",
            depth,
            "--",
        ]
        .into_iter()
        .map(str::to_string)
        .collect();
        args.extend(paths[start..next].iter().map(|p| w::target(p)));
        let args: Vec<_> = args.iter().map(String::as_str).collect();
        statuses
            .extend(svn::parse_status_xml(&w::run(root, &args).await?).map_err(|e| e.to_string())?);
    }
    Ok(statuses)
}
pub(crate) async fn selection_status(
    info: &w::Identity,
    selected: &[String],
) -> w::Result<Vec<crate::SvnStatus>> {
    let mut paths = BTreeSet::from([".".to_string()]);
    for selected in selected {
        child(Path::new(&info.root), selected)?;
        paths.insert(selected.clone());
        for ancestor in Path::new(selected)
            .ancestors()
            .skip(1)
            .filter(|p| !p.as_os_str().is_empty())
        {
            paths.insert(ancestor.to_string_lossy().replace('\\', "/"));
        }
    }
    // Ordinary file/property discards do not inventory unrelated subtrees.
    let statuses =
        status_batch(&info.root, &paths.into_iter().collect::<Vec<_>>(), "empty").await?;
    let recursive: Vec<_> = statuses
        .iter()
        .filter(|s| {
            selected.contains(&s.path)
                && ["added", "deleted", "missing"].contains(&s.status_code.as_str())
        })
        .map(|s| s.path.clone())
        .collect();
    let mut by_path: BTreeMap<_, _> = statuses.into_iter().map(|s| (s.path.clone(), s)).collect();
    // Structural operations still validate their entire affected subtree.
    for status in status_batch(&info.root, &recursive, "infinity").await? {
        by_path.insert(status.path.clone(), status);
    }
    Ok(by_path.into_values().collect())
}
async fn capture(info: &w::Identity, selected: &[String]) -> w::Result<Vec<Node>> {
    let statuses = selection_status(info, selected).await?;
    let root = Path::new(&info.root);
    let selected_set: BTreeSet<_> = selected.iter().cloned().collect();
    let mut nodes = BTreeMap::new();
    for path in selected {
        let full = child(root, path)?;
        if path != "." {
            w::ensure_owned(&info.root, path).await?;
        }
        let status = statuses
            .iter()
            .find(|s| s.path == *path)
            .ok_or_else(|| format!("Selection changed; refresh: {path}"))?;
        if status.history
            || status.switched
            || status.prop_status == "conflicted"
            || ![
                "modified",
                "added",
                "deleted",
                "missing",
                "unversioned",
                "normal",
                "none",
            ]
            .contains(&status.status_code.as_str())
            || (["normal", "none"].contains(&status.status_code.as_str())
                && status.prop_status != "modified")
        {
            return Err(format!(
                "Resolve conflicts, copies/moves or unsupported state separately: {path} ({})",
                status.status_code
            ));
        }
        if status.status_code == "unversioned" {
            walk(root, path, &mut nodes)?;
            continue;
        }
        let xml = w::run(&info.root, &["info", "--xml", "--", &w::target(path)]).await?;
        let node_info = svn::parse_info_xml(&xml).map_err(|e| e.to_string())?;
        let directory = node_info.node_kind == "dir";
        if full.exists() && directory != full.is_dir() {
            return Err(format!("Obstructed path: {path}"));
        }
        // A/D/missing directories require an indivisible recursive revert. Never
        // expand that operation into paths absent from the user's selection.
        if directory && ["added", "deleted", "missing"].contains(&status.status_code.as_str()) {
            for descendant in statuses.iter().filter(|s| under(&s.path, path)) {
                if !selected_set.contains(&descendant.path) {
                    return Err(format!(
                        "Directory operation also requires selecting: {}",
                        descendant.path
                    ));
                }
            }
            if full.exists() {
                let mut disk = BTreeMap::new();
                walk(root, path, &mut disk)?;
                for descendant in disk.keys() {
                    if !selected_set.contains(descendant) {
                        return Err(format!(
                            "Directory contains an unselected path; retained: {descendant}"
                        ));
                    }
                }
            }
        }
        // A child cannot independently cancel its parent's structural operation.
        for ancestor in statuses.iter().filter(|s| under(path, &s.path)) {
            if ancestor.switched {
                return Err(format!(
                    "Handle the switched subtree separately: {}",
                    ancestor.path
                ));
            }
            if ["added", "deleted", "missing", "replaced"].contains(&ancestor.status_code.as_str())
                && !selected_set.contains(&ancestor.path)
            {
                return Err(format!(
                    "Select the parent directory operation as well: {}",
                    ancestor.path
                ));
            }
        }
        let properties = if full.exists() && status.status_code != "deleted" {
            stash::properties(&info.root, path, false).await?
        } else {
            BTreeMap::new()
        };
        nodes.insert(
            path.clone(),
            Node {
                path: path.clone(),
                status: status.status_code.clone(),
                directory,
                hash: if full.is_file() {
                    Some(stash::hash_file(&full)?)
                } else {
                    None
                },
                properties,
                info: serde_json::to_string(&node_info).map_err(|e| e.to_string())?,
                remove: status.status_code == "added",
            },
        );
    }
    Ok(nodes.into_values().collect())
}
#[cfg(test)]
pub async fn preview(path: &str, files: &[String], expected_url: &str) -> w::Result<Preview> {
    preview_protected(path, files, expected_url, &[]).await
}
async fn preview_protected(
    path: &str,
    files: &[String],
    expected_url: &str,
    protected: &[String],
) -> w::Result<Preview> {
    if files.is_empty() {
        return Err("Select changes to discard".into());
    }
    let identity = w::identity(path).await?;
    let xml = w::run(path, &["info", "--xml", "--", "."]).await?;
    if svn::parse_info_xml(&xml).map_err(|e| e.to_string())?.url != expected_url {
        return Err("Working-copy branch changed; refresh and try again".into());
    }
    let workspace = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let root = fs::canonicalize(&identity.root).map_err(|e| e.to_string())?;
    let prefix = workspace
        .strip_prefix(&root)
        .map_err(|_| "Outside working copy")?;
    let relative_paths = |files: &[String]| -> w::Result<BTreeSet<String>> {
        files
            .iter()
            .map(|file| {
                child(&workspace, file)?;
                let relative = prefix
                    .join(if file == "." { "" } else { file })
                    .to_string_lossy()
                    .replace('\\', "/");
                Ok(if relative.is_empty() {
                    ".".into()
                } else {
                    relative.trim_end_matches('/').to_string()
                })
            })
            .collect::<w::Result<BTreeSet<_>>>()
    };
    let mut selected = relative_paths(files)?;
    let protected = relative_paths(protected)?;
    // SVN's ordinary status collapses a directory deletion/missing subtree to
    // its parent. Preview the implicit descendants too, without claiming any
    // separately staged, filtered or otherwise protected path.
    let statuses =
        selection_status(&identity, &selected.iter().cloned().collect::<Vec<_>>()).await?;
    for path in selected.clone() {
        if let Some(parent) = statuses
            .iter()
            .find(|s| s.path == path && ["deleted", "missing"].contains(&s.status_code.as_str()))
        {
            for descendant in statuses.iter().filter(|s| under(&s.path, &path)) {
                if descendant.status_code == parent.status_code
                    && !selected.contains(&descendant.path)
                {
                    if protected
                        .iter()
                        .any(|p| p == &descendant.path || under(p, &descendant.path))
                    {
                        return Err(format!(
                            "Directory operation contains a protected change: {}",
                            descendant.path
                        ));
                    }
                    selected.insert(descendant.path.clone());
                }
            }
        }
    }
    let selected: Vec<_> = selected.into_iter().collect();
    let nodes = capture(&identity, &selected).await?;
    if let Some(node) = nodes.iter().find(|n| protected.contains(&n.path)) {
        return Err(format!(
            "Selection contains a protected change: {}",
            node.path
        ));
    }
    let result = Preview {
        id: w::id(),
        nodes: nodes.clone(),
    };
    let mut plans = PLANS
        .get_or_init(Default::default)
        .lock()
        .map_err(|e| e.to_string())?;
    plans.retain(|_, p| p.created.elapsed() < Duration::from_secs(600));
    if plans.len() >= 32 {
        return Err("Too many pending discard confirmations; retry later".into());
    }
    plans.insert(
        result.id.clone(),
        Plan {
            created: Instant::now(),
            identity,
            workspace: path.to_string(),
            workspace_prefix: prefix.to_string_lossy().replace('\\', "/"),
            expected_url: expected_url.to_string(),
            selected,
            nodes,
        },
    );
    Ok(result)
}
pub async fn execute(id: &str) -> w::Result<Outcome> {
    let plan = PLANS
        .get_or_init(Default::default)
        .lock()
        .map_err(|e| e.to_string())?
        .remove(id)
        .ok_or("Discard confirmation expired; preview again")?;
    if plan.created.elapsed() >= Duration::from_secs(600) {
        return Err("Discard confirmation expired".into());
    }
    let root = &plan.identity.root;
    let _guard = w::acquire(root).await?;
    if w::identity(root).await? != plan.identity
        || capture(&plan.identity, &plan.selected).await? != plan.nodes
    {
        return Err("Files, properties or branch changed after preview; nothing discarded".into());
    }
    let mut outcome = Outcome {
        completed_paths: Vec::new(),
        error: None,
        status: None,
    };
    let started = Instant::now();
    let result = apply(&plan, &mut outcome).await;
    let operation_ms = started.elapsed().as_millis();
    if let Err(error) = result {
        outcome.error = Some(error);
    }
    if let Err(error) = svn::invalidate_status(Path::new(root)) {
        tracing::warn!(%error, "discard cache invalidation requires a complete scan");
        return Ok(outcome);
    }
    let refresh_started = Instant::now();
    match status_after_discard(&plan).await {
        Ok(status) => outcome.status = Some(status),
        Err(error) => tracing::warn!(%error, "discard status refresh requires a complete scan"),
    }
    tracing::info!(
        targets = plan.nodes.len(),
        operation_ms,
        refresh_ms = refresh_started.elapsed().as_millis(),
        scoped = outcome.status.is_some(),
        "discard and status refresh completed"
    );
    Ok(outcome)
}

async fn status_after_discard(plan: &Plan) -> w::Result<StatusPatch> {
    let mut paths = BTreeSet::new();
    let mut subtrees: Vec<String> = Vec::new();
    for node in &plan.nodes {
        paths.insert(node.path.clone());
        for ancestor in Path::new(&node.path).ancestors().skip(1) {
            let path = ancestor.to_string_lossy().replace('\\', "/");
            paths.insert(if path.is_empty() { ".".into() } else { path });
        }
        if node.directory
            && (node.remove || ["deleted", "missing"].contains(&node.status.as_str()))
            && !subtrees.iter().any(|p| under(&node.path, p))
        {
            subtrees.push(node.path.clone());
        }
    }
    // Directory property edits are exact queries. Only structural operations
    // query descendants, including unexpected contents retained after failure.
    let exact: Vec<_> = paths
        .iter()
        .filter(|p| !subtrees.iter().any(|tree| *p == tree || under(p, tree)))
        .cloned()
        .collect();
    let mut entries = status_batch(&plan.identity.root, &exact, "empty").await?;
    entries.extend(status_batch(&plan.identity.root, &subtrees, "infinity").await?);
    if w::identity(&plan.identity.root).await? != plan.identity {
        return Err("Working-copy identity changed during refresh".into());
    }
    let relative = |path: &str| -> Option<String> {
        if plan.workspace_prefix.is_empty() {
            Some(path.to_string())
        } else if path == plan.workspace_prefix {
            Some(".".into())
        } else {
            path.strip_prefix(&format!("{}/", plan.workspace_prefix))
                .map(str::to_string)
        }
    };
    let mut fresh = BTreeMap::new();
    for mut entry in entries {
        if ["normal", "none", "ignored"].contains(&entry.status_code.as_str())
            && !["modified", "conflicted"].contains(&entry.prop_status.as_str())
        {
            continue;
        }
        if let Some(path) = relative(&entry.path) {
            entry.path = path;
            fresh.insert(entry.path.clone(), entry);
        }
    }
    Ok(StatusPatch {
        workspace: plan.workspace.clone(),
        expected_url: plan.expected_url.clone(),
        paths: paths.iter().filter_map(|p| relative(p)).collect(),
        subtrees: subtrees.iter().filter_map(|p| relative(p)).collect(),
        entries: fresh.into_values().collect(),
    })
}
async fn apply(plan: &Plan, outcome: &mut Outcome) -> w::Result<()> {
    let root = &plan.identity.root;
    let mut recursively_reverted: Vec<String> = Vec::new();
    // Parents precede children for SVN scheduling; child deletion comes later.
    for node in &plan.nodes {
        if node.status == "unversioned" {
            continue;
        }
        if !recursively_reverted.iter().any(|p| under(&node.path, p)) {
            let recursive =
                node.directory && ["added", "deleted", "missing"].contains(&node.status.as_str());
            let expected: Vec<_> = plan
                .nodes
                .iter()
                .filter(|n| n.path == node.path || (recursive && under(&n.path, &node.path)))
                .cloned()
                .collect();
            let selected: Vec<_> = expected.iter().map(|n| n.path.clone()).collect();
            if w::identity(root).await? != plan.identity
                || capture(&plan.identity, &selected).await? != expected
            {
                return Err(format!("Selection changed; retained: {}", node.path));
            }
            w::run(
                root,
                &[
                    "revert",
                    "--depth",
                    if recursive { "infinity" } else { "empty" },
                    "--",
                    &w::target(&node.path),
                ],
            )
            .await?;
            if recursive {
                recursively_reverted.push(node.path.clone());
            }
        }
        if !node.remove {
            outcome.completed_paths.push(node.path.clone());
        }
    }
    for node in plan.nodes.iter().rev().filter(|n| n.remove) {
        if w::identity(root).await? != plan.identity {
            return Err("Working-copy branch changed; remaining paths retained".into());
        }
        w::ensure_owned(root, &node.path).await?;
        let full = child(Path::new(root), &node.path)?;
        if full.exists() {
            let xml = w::run(
                root,
                &[
                    "status",
                    "--xml",
                    "--no-ignore",
                    "--verbose",
                    "--depth",
                    "empty",
                    "--",
                    &w::target(&node.path),
                ],
            )
            .await?;
            let statuses = svn::parse_status_xml(&xml).map_err(|e| e.to_string())?;
            if statuses
                .iter()
                .any(|s| !["unversioned", "ignored"].contains(&s.status_code.as_str()))
            {
                return Err(format!("Path became versioned; retained: {}", node.path));
            }
            if node.directory {
                // Never recursive delete: retain anything created after preview.
                fs::remove_dir(&full)
                    .map_err(|e| format!("Directory retained {}: {e}", node.path))?;
            } else {
                if Some(stash::hash_file(&full)?) != node.hash {
                    return Err(format!("File changed; retained: {}", node.path));
                }
                fs::remove_file(&full).map_err(|e| format!("File retained {}: {e}", node.path))?;
            }
        }
        outcome.completed_paths.push(node.path.clone());
    }
    Ok(())
}
#[tauri::command]
pub async fn preview_workspace_discard(
    path: String,
    files: Vec<String>,
    expected_url: String,
    protected_files: Vec<String>,
) -> w::Result<Preview> {
    preview_protected(&path, &files, &expected_url, &protected_files).await
}
#[tauri::command]
pub async fn execute_workspace_discard(plan_id: String) -> w::Result<Outcome> {
    execute(&plan_id).await
}
#[tauri::command]
pub fn cancel_workspace_discard(plan_id: String) -> w::Result<()> {
    PLANS
        .get_or_init(Default::default)
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&plan_id);
    Ok(())
}
