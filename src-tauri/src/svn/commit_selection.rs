//! A selected commit validates once under the writer gate, then refreshes only
//! affected paths. Whole-working-copy commits retain their explicit legacy API.
use super::{execute_svn, executor::SvnError, info, parse_status_xml, StatusPatch};
use crate::{workflows as w, SvnInfo, SvnStatus};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    time::Instant,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitOutcome {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
    pub added: bool,
    pub added_paths: Vec<String>,
    pub status: Option<StatusPatch>,
    pub info: Option<SvnInfo>,
    pub warning: Option<String>,
    pub timings: CommitTimings,
}
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitTimings {
    pub check_ms: f64,
    pub commit_ms: f64,
    pub refresh_ms: f64,
}
impl CommitOutcome {
    pub fn whole(output: String) -> Self {
        Self {
            success: true,
            output,
            error: None,
            added: false,
            added_paths: Vec::new(),
            status: None,
            info: None,
            warning: None,
            timings: CommitTimings::default(),
        }
    }
}

fn invalid(message: impl Into<String>) -> SvnError {
    SvnError::InvalidArguments(message.into())
}
fn normalize(path: &str) -> String {
    let path = path.replace('\\', "/");
    let path = path
        .strip_prefix("./")
        .unwrap_or(&path)
        .trim_end_matches('/');
    if path.is_empty() {
        ".".into()
    } else {
        path.into()
    }
}
fn has_structural_parent(path: &str, roots: &BTreeSet<String>) -> bool {
    (path != "." && roots.contains("."))
        || Path::new(path)
            .ancestors()
            .skip(1)
            .any(|parent| roots.contains(&parent.to_string_lossy().replace('\\', "/")))
}
fn top_roots(roots: BTreeSet<String>) -> Vec<String> {
    roots
        .iter()
        .filter(|path| !has_structural_parent(path, &roots))
        .cloned()
        .collect()
}
fn only_absent_target_errors(output: &str) -> bool {
    let codes: Vec<_> = output
        .lines()
        .filter_map(|line| line.trim().strip_prefix("svn: "))
        .map(|line| {
            // SVN can prefix warnings with "warning:" before the numeric code.
            line.split(':')
                .map(str::trim)
                .find(|part| {
                    part.len() == 7
                        && matches!(part.as_bytes()[0], b'W' | b'E')
                        && part.as_bytes()[1..].iter().all(u8::is_ascii_digit)
                })
                .unwrap_or("")
        })
        .collect();
    codes
        .iter()
        .any(|code| matches!(*code, "W155010" | "E155010"))
        && codes
            .iter()
            .all(|code| matches!(*code, "W155010" | "E155010" | "E200009"))
}
fn validate_paths(root: &str, files: &[String]) -> Result<Vec<String>, SvnError> {
    if files.is_empty() {
        return Err(invalid("显式文件列表不能为空"));
    }
    let mut result = BTreeSet::new();
    for file in files {
        if file.is_empty() || file.replace('\\', "/").starts_with('/') {
            return Err(invalid("Invalid commit target"));
        }
        let path = normalize(file);
        if path != "." {
            let full = w::safe_child(Path::new(root), &path).map_err(invalid)?;
            for candidate in full.ancestors().take_while(|p| *p != Path::new(root)) {
                if candidate.join(".svn").exists() || candidate.join(".git").exists() {
                    return Err(invalid(format!("Nested or external working copy: {path}")));
                }
            }
        }
        result.insert(path);
    }
    Ok(result.into_iter().collect())
}

async fn query(
    root: &str,
    paths: &[String],
    depth: &str,
    verbose: bool,
) -> Result<Vec<SvnStatus>, SvnError> {
    let mut entries = Vec::new();
    let mut next = 0;
    while next < paths.len() {
        let start = next;
        let mut bytes = 0;
        while next < paths.len()
            && next - start < 64
            && (next == start || bytes + paths[next].len() < 8000)
        {
            bytes += paths[next].len() + 4;
            next += 1;
        }
        let mut args: Vec<String> = ["status", "--xml", "--ignore-externals", "--depth", depth]
            .into_iter()
            .map(str::to_string)
            .collect();
        if verbose {
            args.push("--verbose".into());
        }
        args.push("--".into());
        args.extend(paths[start..next].iter().map(|p| w::target(p)));
        let refs: Vec<_> = args.iter().map(String::as_str).collect();
        let output = match execute_svn(&refs, Some(root)).await {
            Ok(output) => output,
            Err(SvnError::CommandFailed(output)) if only_absent_target_errors(&output) => {
                // A missing scheduled addition may disappear after svn delete.
                let a = output
                    .find("<status>")
                    .ok_or_else(|| invalid(output.clone()))?;
                let b = output[a..]
                    .find("</status>")
                    .ok_or_else(|| invalid(output.clone()))?;
                output[a..a + b + 9].into()
            }
            Err(error) => return Err(error),
        };
        // Explicit file-external targets can survive --ignore-externals. They
        // belong to a different source and must not join a selected commit.
        let mut reader = quick_xml::Reader::from_str(&output);
        loop {
            match reader.read_event() {
                Ok(quick_xml::events::Event::Start(e) | quick_xml::events::Event::Empty(e))
                    if e.name().as_ref() == b"wc-status" =>
                {
                    if e.attributes()
                        .flatten()
                        .any(|a| a.key.as_ref() == b"file-external" && a.value.as_ref() == b"true")
                    {
                        return Err(invalid(
                            "File externals cannot be included in a selected commit",
                        ));
                    }
                }
                Ok(quick_xml::events::Event::Eof) => break,
                Err(error) => return Err(SvnError::ParseError(error.to_string())),
                _ => {}
            }
        }
        entries.extend(parse_status_xml(&output)?);
    }
    Ok(entries)
}

pub(super) async fn selection_status(
    root: &str,
    files: &[String],
) -> Result<Vec<SvnStatus>, SvnError> {
    let files = validate_paths(root, files)?;
    let exact = query(root, &files, "empty", false).await?;
    let recursive = top_roots(
        exact
            .iter()
            .filter(|s| matches!(s.status_code.as_str(), "deleted" | "replaced" | "missing"))
            .map(|s| s.path.clone())
            .collect(),
    );
    let mut entries: BTreeMap<_, _> = exact.into_iter().map(|s| (s.path.clone(), s)).collect();
    for entry in query(root, &recursive, "infinity", true).await? {
        entries.insert(entry.path.clone(), entry);
    }
    // Status may collapse an absent directory. Local info still enumerates its
    // BASE children so an atomic deletion cannot consume deselected files.
    for path in recursive
        .iter()
        .filter(|p| entries.get(*p).is_some_and(|s| s.status_code == "missing"))
        .cloned()
        .collect::<Vec<_>>()
    {
        let xml = execute_svn(
            &[
                "info",
                "--xml",
                "--depth",
                "infinity",
                "--",
                &w::target(&path),
            ],
            Some(root),
        )
        .await?;
        let children: Vec<_> = super::parser::parse_info_paths_xml(&xml)?
            .into_iter()
            .map(|p| normalize(&p))
            .filter(|p| !entries.contains_key(p))
            .collect();
        for child in query(root, &children, "empty", true).await? {
            entries.insert(child.path.clone(), child);
        }
    }
    Ok(entries.into_values().collect())
}

fn scope_paths(selected: &[String]) -> Vec<String> {
    let mut result = BTreeSet::from([".".to_string()]);
    for file in selected {
        result.insert(file.clone());
        let mut parent = Path::new(file).parent();
        while let Some(path) = parent.filter(|p| !p.as_os_str().is_empty()) {
            result.insert(path.to_string_lossy().replace('\\', "/"));
            parent = path.parent();
        }
    }
    result.into_iter().collect()
}
fn changed(entry: &SvnStatus) -> bool {
    !matches!(
        entry.status_code.as_str(),
        "normal" | "none" | "ignored" | "external"
    ) || matches!(entry.prop_status.as_str(), "modified" | "conflicted")
}

fn request_info(root: &str) -> tokio::task::JoinHandle<Result<SvnInfo, SvnError>> {
    let root = root.to_string();
    tokio::spawn(async move { info(&root).await })
}

async fn refresh_patch(
    root: &str,
    url: &str,
    selected: &[String],
    structural: &[String],
) -> Result<(StatusPatch, SvnInfo), SvnError> {
    let paths = scope_paths(selected);
    // Absent descendants of a committed directory deletion are covered by its
    // recursive parent, avoiding an error for every former child.
    let structural_set = structural.iter().cloned().collect();
    let exact: Vec<_> = paths
        .iter()
        .filter(|p| !has_structural_parent(p, &structural_set))
        .cloned()
        .collect();
    let info_request = request_info(root);
    let exact_entries = query(root, &exact, "empty", false).await;
    let current = info_request.await.map_err(|e| invalid(e.to_string()))??;
    let exact_entries = exact_entries?;
    if current.url != url {
        return Err(invalid("Working copy source changed during commit"));
    }
    let mut entries: BTreeMap<_, _> = exact_entries
        .into_iter()
        .map(|s| (s.path.clone(), s))
        .collect();
    let existing: Vec<_> = structural
        .iter()
        .filter(|p| Path::new(root).join(p).exists())
        .cloned()
        .collect();
    for entry in query(root, &existing, "infinity", false).await? {
        entries.insert(entry.path.clone(), entry);
    }
    Ok((
        StatusPatch {
            workspace: root.into(),
            expected_url: url.into(),
            paths,
            subtrees: structural.to_vec(),
            entries: entries.into_values().filter(changed).collect(),
        },
        current,
    ))
}

pub async fn commit_selection(
    root: &str,
    message: &str,
    files: &[String],
    expected_url: Option<&str>,
    auto_delete: bool,
) -> Result<CommitOutcome, String> {
    if message.trim().is_empty() {
        return Err("Commit message is required".into());
    }
    let started = Instant::now();
    let _writer = w::acquire(root).await?;
    w::progress("checking", "", 0, files.len());
    let selected = validate_paths(root, files).map_err(|e| e.to_string())?;
    // Both are local reads made while holding the same working-copy writer gate.
    let info_request = request_info(root);
    let statuses = selection_status(root, &selected).await;
    let before = info_request
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let statuses = statuses.map_err(|e| e.to_string())?;
    if expected_url.is_some_and(|url| url != before.url) {
        return Err("Working copy source changed; review the selection again".into());
    }
    let available: BTreeMap<_, _> = statuses.iter().map(|s| (s.path.as_str(), s)).collect();
    for file in &selected {
        let status = available
            .get(file.as_str())
            .ok_or_else(|| format!("Selected path is no longer changed: {file}"))?;
        if status.status_code == "conflicted" || status.prop_status == "conflicted" {
            return Err(format!("Resolve conflicts before committing: {file}"));
        }
        if status.switched
            || matches!(
                status.status_code.as_str(),
                "external" | "ignored" | "normal" | "none"
            ) && !matches!(status.prop_status.as_str(), "modified" | "conflicted")
        {
            return Err(format!("Selected path is not an eligible change: {file}"));
        }
        if status.status_code == "missing" && !auto_delete {
            return Err(format!(
                "Missing path is not scheduled for deletion: {file}"
            ));
        }
    }
    let selected_set: BTreeSet<_> = selected.iter().collect();
    let to_add: Vec<_> = statuses
        .iter()
        .filter(|s| selected_set.contains(&s.path) && s.status_code == "unversioned")
        .map(|s| s.path.clone())
        .collect();
    let structural_set: BTreeSet<_> = statuses
        .iter()
        .filter(|s| {
            selected_set.contains(&s.path)
                && matches!(
                    s.status_code.as_str(),
                    "added" | "deleted" | "replaced" | "missing" | "unversioned"
                )
        })
        .map(|s| s.path.clone())
        .collect();
    let structural = top_roots(structural_set);
    let added = !to_add.is_empty();
    let check_ms = started.elapsed().as_secs_f64() * 1000.;
    w::progress(
        if added { "adding" } else { "committing" },
        "",
        0,
        selected.len(),
    );
    let started = Instant::now();
    let result = if added {
        super::add(root, &to_add).await
    } else {
        super::operations::commit_from_status(
            root,
            message,
            Some(&selected),
            auto_delete,
            &statuses,
        )
        .await
    };
    let commit_ms = started.elapsed().as_secs_f64() * 1000.;
    // Invalidate a pre-existing background scan without waiting for its mutex.
    let _ = super::invalidate_status(Path::new(root));
    w::progress("refreshing", "", selected.len(), selected.len());
    let started = Instant::now();
    let refreshed = refresh_patch(root, &before.url, &selected, &structural).await;
    let refresh_ms = started.elapsed().as_secs_f64() * 1000.;
    let (status, current, warning) = match refreshed {
        Ok((status, info)) => (Some(status), Some(info), None),
        Err(error) => (None, None, Some(error.to_string())),
    };
    let (success, output, error) = match result {
        Ok(output) => (true, output, None),
        Err(error) => (false, String::new(), Some(error.to_string())),
    };
    tracing::info!(
        check_ms,
        commit_ms,
        refresh_ms,
        selected = selected.len(),
        success,
        "selected commit phases"
    );
    Ok(CommitOutcome {
        success,
        output,
        error,
        added,
        added_paths: to_add,
        status,
        info: current,
        warning,
        timings: CommitTimings {
            check_ms,
            commit_ms,
            refresh_ms,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scoped_submission_absent_targets_do_not_hide_other_errors() {
        assert!(only_absent_target_errors(
            "svn: warning: W155010: missing\nsvn: E200009: target absent"
        ));
        assert!(!only_absent_target_errors(
            "svn: warning: W155010: missing\nsvn: E170013: forbidden"
        ));
        assert!(!only_absent_target_errors(
            "svn: E200009: arbitrary failure"
        ));
        assert_eq!(normalize("..hidden/file.txt"), "..hidden/file.txt");
        assert_eq!(
            top_roots(BTreeSet::from(["a".into(), "a/b".into(), "ab/c".into()])),
            ["a", "ab/c"]
        );
    }
}
