use super::{execute_svn, info};
use crate::{workflows::safe_child, SvnLogEntry};
use quick_xml::{events::Event, Reader};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::SystemTime,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPresence {
    pub working_url: String,
    pub base_revision: u64,
    pub scope_matches: bool,
    pub rows: Vec<RevisionPresence>,
    pub base_fingerprint: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RevisionPresence {
    pub revision: u64,
    pub state: &'static str,
    pub included: usize,
    pub pending: usize,
    pub unknown: usize,
    pub reasons: Vec<&'static str>,
    pub basis: &'static str,
}

#[derive(Default, Debug)]
struct Node {
    path: String,
    revision: Option<u64>,
    url: String,
    kind: String,
    schedule: String,
    depth: String,
}

#[derive(Clone, Debug)]
struct BaseRange {
    min: u64,
    max: u64,
    complete: bool,
    sparse: bool,
    switched: bool,
    modified: bool,
}

fn parse_range(output: &str) -> Option<BaseRange> {
    let output = output.trim();
    let end = output
        .find(|c: char| !c.is_ascii_digit() && c != ':')
        .unwrap_or(output.len());
    let (numbers, flags) = output.split_at(end);
    if !flags.chars().all(|c| matches!(c, 'M' | 'S' | 'P')) {
        return None;
    }
    let mut revisions = numbers.split(':');
    let min = revisions.next()?.parse().ok()?;
    let max = revisions
        .next()
        .map(str::parse)
        .transpose()
        .ok()?
        .unwrap_or(min);
    if revisions.next().is_some() || min > max {
        return None;
    }
    Some(BaseRange {
        min,
        max,
        complete: !flags.contains('S') && !flags.contains('P'),
        sparse: flags.contains('P'),
        switched: flags.contains('S'),
        modified: flags.contains('M'),
    })
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct DbStamp(Vec<(PathBuf, u64, SystemTime)>);

pub fn history_base_fingerprint(workspace: &str) -> Option<String> {
    db_stamp(workspace).map(fingerprint)
}

fn fingerprint(stamp: DbStamp) -> String {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    stamp.hash(&mut hash);
    format!("{:016x}", hash.finish())
}
fn db_stamp(workspace: &str) -> Option<DbStamp> {
    for parent in Path::new(workspace).ancestors() {
        let db = parent.join(".svn/wc.db");
        if !db.is_file() {
            continue;
        }
        let mut files = Vec::new();
        for path in [
            db,
            parent.join(".svn/wc.db-wal"),
            parent.join(".svn/wc.db-journal"),
        ] {
            match std::fs::metadata(&path) {
                Ok(meta) => files.push((path, meta.len(), meta.modified().ok()?)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return None,
            }
        }
        return Some(DbStamp(files));
    }
    None
}

type CachedRange = Arc<tokio::sync::Mutex<Option<(DbStamp, Option<BaseRange>)>>>;
static BASE_RANGES: OnceLock<Mutex<VecDeque<(String, CachedRange)>>> = OnceLock::new();
fn range_cache(key: String) -> Result<CachedRange, String> {
    let mut cache = BASE_RANGES
        .get_or_init(|| Mutex::new(VecDeque::new()))
        .lock()
        .map_err(|e| e.to_string())?;
    if let Some(index) = cache.iter().position(|(k, _)| k == &key) {
        let entry = cache.remove(index).unwrap();
        let result = entry.1.clone();
        cache.push_back(entry);
        return Ok(result);
    }
    let value = Arc::new(tokio::sync::Mutex::new(None));
    cache.push_back((key, value.clone()));
    while cache.len() > 8 {
        cache.pop_front();
    }
    Ok(value)
}

async fn base_range(workspace: &str, working_url: &str) -> Result<Option<BaseRange>, String> {
    let before = db_stamp(workspace);
    let executable = super::executor::current_svn_executable().map_err(|e| e.to_string())?;
    let key = format!("{workspace}\n{working_url}\n{}", executable.display());
    let cache = range_cache(key)?;
    let mut cached = cache.lock().await;
    if let (Some(stamp), Some((saved, result))) = (&before, &*cached) {
        if stamp == saved {
            return Ok(result.clone());
        }
    }
    let mut range = super::executor::execute_svnversion(workspace)
        .await
        .ok()
        .and_then(|s| parse_range(&s));
    let mut cacheable = range.is_some();
    // M also covers harmless text edits. Validate schedules from metadata once,
    // rather than disabling the range optimization for every edited working file.
    if let Some(range) = range.as_mut() {
        if range.complete && range.modified {
            range.complete = false;
            cacheable = false;
            if let Ok(xml) = execute_svn(
                &["info", "--xml", "--depth", "infinity", "--", ".@"],
                Some(workspace),
            )
            .await
            {
                let nodes = parse_nodes(&xml);
                cacheable = !nodes.is_empty();
                if let Some((origin, root_path)) = decoded_url(working_url) {
                    range.complete = !nodes.is_empty()
                        && nodes.iter().all(|node| {
                            node.schedule == "normal"
                                && node.revision.is_some()
                                && (node.kind != "dir" || node.depth == "infinity")
                                && decoded_url(&node.url).is_some_and(|(node_origin, path)| {
                                    node_origin == origin && within(&path, &root_path)
                                })
                        });
                }
            }
        }
    }
    let after = db_stamp(workspace);
    if before != after {
        return Err("Working copy changed during BASE range check".into());
    }
    if cacheable {
        if let Some(stamp) = after {
            *cached = Some((stamp, range.clone()));
        }
    }
    Ok(range)
}

fn add_reason(row: &mut RevisionPresence, reason: &'static str) {
    if !row.reasons.contains(&reason) {
        row.reasons.push(reason);
    }
}

fn decoded_url(value: &str) -> Option<(String, String)> {
    let url = url::Url::parse(value).ok()?;
    let path = super::operations::percent_decode(url.path())?;
    Some((
        url[..url::Position::BeforePath].to_string(),
        path.trim_end_matches('/').to_string(),
    ))
}

fn within(value: &str, root: &str) -> bool {
    value == root
        || value
            .strip_prefix(root)
            .is_some_and(|rest| rest.starts_with('/'))
}

fn relative_path(path: &str, scope: &str, root: &Path) -> Option<String> {
    let relative = if path == scope {
        "."
    } else {
        path.strip_prefix(scope)?.strip_prefix('/')?
    };
    if relative != "." {
        safe_child(root, relative).ok()?;
    }
    Some(relative.to_string())
}

fn parse_nodes(xml: &str) -> Vec<Node> {
    let mut reader = Reader::from_str(xml);
    let mut node = Node::default();
    let mut tag = String::new();
    let mut nodes = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match e.name().as_ref() {
                b"entry" => {
                    let attr = |key| {
                        e.try_get_attribute(key)
                            .ok()
                            .flatten()
                            .and_then(|a| a.unescape_value().ok().map(|s| s.into_owned()))
                    };
                    node = Node {
                        path: attr("path").unwrap_or_default(),
                        kind: attr("kind").unwrap_or_default(),
                        revision: attr("revision").and_then(|s| s.parse().ok()),
                        ..Node::default()
                    };
                }
                b"url" => tag = "url".into(),
                b"schedule" => tag = "schedule".into(),
                b"depth" => tag = "depth".into(),
                _ => tag.clear(),
            },
            Ok(Event::Text(e)) => {
                let value = e.unescape().unwrap_or_default().into_owned();
                match tag.as_str() {
                    "url" => node.url.push_str(&value),
                    "schedule" => node.schedule.push_str(&value),
                    "depth" => node.depth.push_str(&value),
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                if e.name().as_ref() == b"entry" {
                    nodes.push(std::mem::take(&mut node));
                }
                tag.clear();
            }
            Ok(Event::Eof) => return nodes,
            Err(_) => return Vec::new(),
            _ => {}
        }
    }
}

async fn query_nodes(
    workspace: &str,
    paths: &[String],
) -> (HashMap<String, Node>, HashSet<String>) {
    let mut nodes = HashMap::new();
    let mut failed = HashSet::new();
    for group in paths.chunks(64) {
        let mut args = vec![
            "info".to_string(),
            "--xml".into(),
            "--depth".into(),
            "empty".into(),
            "--".into(),
        ];
        args.extend(group.iter().map(|path| format!("{path}@")));
        let args: Vec<_> = args.iter().map(String::as_str).collect();
        // SVN can emit complete XML for existing paths while returning an error
        // for another target. Keep verified entries; omitted targets stay unknown.
        let output = match execute_svn(&args, Some(workspace)).await {
            Ok(output) => output,
            Err(super::executor::SvnError::CommandFailed(output)) => output,
            Err(_) => {
                failed.extend(group.iter().cloned());
                continue;
            }
        };
        let Some(start) = output.find("<info>") else {
            failed.extend(group.iter().cloned());
            continue;
        };
        let Some(end) = output[start..].find("</info>") else {
            failed.extend(group.iter().cloned());
            continue;
        };
        for mut node in parse_nodes(&output[start..start + end + 7]) {
            node.path = node.path.replace('\\', "/");
            if Path::new(&node.path).is_absolute() {
                let Ok(relative) = Path::new(&node.path).strip_prefix(workspace) else {
                    continue;
                };
                node.path = relative.to_string_lossy().replace('\\', "/");
            }
            if node.path.is_empty() {
                node.path = ".".into();
            }
            if group.contains(&node.path) {
                nodes.insert(node.path.clone(), node);
            }
        }
    }
    (nodes, failed)
}

struct PresenceContext<'a> {
    scope: &'a str,
    root: &'a Path,
    origin: &'a str,
    working_path: &'a str,
    nodes: &'a HashMap<String, Node>,
    matches: bool,
    range: Option<&'a BaseRange>,
    failed: &'a HashSet<String>,
}

fn classify(entry: &SvnLogEntry, context: &PresenceContext<'_>) -> RevisionPresence {
    let PresenceContext {
        scope,
        root,
        origin,
        working_path,
        nodes,
        matches,
        range,
        failed,
    } = *context;
    let mut row = RevisionPresence {
        revision: entry.revision,
        state: "unknown",
        included: 0,
        pending: 0,
        unknown: 0,
        reasons: Vec::new(),
        basis: "paths",
    };
    if !matches {
        row.unknown = entry.changed_paths.len().max(1);
        add_reason(&mut row, "other_source");
        return row;
    }
    let mut seen = HashSet::new();
    for changed in &entry.changed_paths {
        if !within(&changed.path, scope) {
            continue;
        }
        if !seen.insert(&changed.path) {
            continue;
        }
        let Some(relative) = relative_path(&changed.path, scope, root) else {
            add_reason(&mut row, "invalid_path");
            row.unknown += 1;
            continue;
        };
        if let Some(range) = range.filter(|r| r.complete) {
            if entry.revision <= range.min {
                row.included += 1;
                row.basis = "range";
                continue;
            }
            if entry.revision > range.max {
                row.pending += 1;
                row.basis = "range";
                continue;
            }
        }
        let Some(node) = nodes.get(&relative) else {
            row.unknown += 1;
            add_reason(
                &mut row,
                if failed.contains(&relative) {
                    "query_failed"
                } else if range.is_some_and(|r| r.sparse) {
                    "sparse"
                } else if range.is_some_and(|r| r.switched) {
                    "switched"
                } else {
                    "missing_metadata"
                },
            );
            continue;
        };
        let expected = if relative == "." {
            working_path.to_string()
        } else {
            format!("{working_path}/{relative}")
        };
        let Some((node_origin, node_path)) = decoded_url(&node.url) else {
            row.unknown += 1;
            add_reason(&mut row, "invalid_url");
            continue;
        };
        if node_origin != origin || node_path != expected {
            row.unknown += 1;
            add_reason(&mut row, "switched");
        } else if node.schedule != "normal" {
            row.unknown += 1;
            add_reason(&mut row, "scheduled");
        } else if node.depth == "exclude" {
            row.unknown += 1;
            add_reason(&mut row, "sparse");
        } else if node.kind == "dir" && changed.action != "M" {
            row.unknown += 1;
            add_reason(&mut row, "directory_change");
        } else if let Some(revision) = node.revision {
            if revision >= entry.revision {
                row.included += 1;
            } else {
                row.pending += 1;
            }
        } else {
            row.unknown += 1;
            add_reason(&mut row, "missing_base");
        }
    }
    if row.included + row.pending + row.unknown == 0 {
        add_reason(&mut row, "no_paths");
    }
    if row.unknown > 0 && range.is_none() {
        add_reason(&mut row, "range_unavailable");
    }
    row.state = if row.included > 0 && row.pending > 0 {
        "partial"
    } else if row.unknown > 0 || row.included + row.pending == 0 {
        "unknown"
    } else if row.pending > 0 {
        "pending"
    } else {
        "included"
    };
    row
}

/// A bounded, local BASE check for the displayed history page. Does not update,
/// download, resolve, or infer that the root revision covers mixed descendants.
pub async fn history_presence(
    workspace: &str,
    expected_url: &str,
    source: &str,
    entries: &[SvnLogEntry],
) -> Result<HistoryPresence, String> {
    if entries.len() > 128 {
        return Err("History page is too large".into());
    }
    let before = info(workspace).await.map_err(|e| e.to_string())?;
    let working = decoded_url(&before.url).ok_or("Invalid working copy URL")?;
    if decoded_url(expected_url).as_ref() != Some(&working) {
        return Err("Working copy changed; refresh history".into());
    }
    let repository = decoded_url(&before.repository_root).ok_or("Invalid repository URL")?;
    let scope = working
        .1
        .strip_prefix(&repository.1)
        .ok_or("Working copy is outside its repository")?;
    let matches = decoded_url(source)
        .is_some_and(|(origin, path)| origin == working.0 && within(&path, &working.1))
        && before.schedule == "normal";
    let root = Path::new(workspace);
    let stamp = db_stamp(workspace);
    let range = if matches {
        base_range(workspace, &before.url).await?
    } else {
        None
    };
    let mut paths = Vec::new();
    let mut seen = HashSet::new();
    if matches {
        for entry in entries {
            if range
                .as_ref()
                .is_some_and(|r| r.complete && (entry.revision <= r.min || entry.revision > r.max))
            {
                continue;
            }
            for changed in &entry.changed_paths {
                if let Some(relative) = relative_path(&changed.path, scope, root) {
                    if seen.insert(relative.clone()) {
                        paths.push(relative);
                    }
                }
            }
        }
    }
    let (nodes, failed) = query_nodes(workspace, &paths).await;
    let after = info(workspace).await.map_err(|e| e.to_string())?;
    if after.url != before.url || after.revision != before.revision || stamp != db_stamp(workspace)
    {
        return Err("Working copy changed during history check".into());
    }
    let context = PresenceContext {
        scope,
        root,
        origin: &working.0,
        working_path: &working.1,
        nodes: &nodes,
        matches,
        range: range.as_ref(),
        failed: &failed,
    };
    let rows = entries
        .iter()
        .map(|entry| classify(entry, &context))
        .collect();
    Ok(HistoryPresence {
        working_url: before.url,
        base_revision: before.revision,
        scope_matches: matches,
        rows,
        base_fingerprint: stamp.map(fingerprint),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_presence_parses_base_ranges_without_guessing_invalid_or_sparse_results() {
        let single = parse_range("150\n").unwrap();
        assert!(single.complete);
        assert_eq!((single.min, single.max), (150, 150));
        let mixed = parse_range("120:150M").unwrap();
        assert!(mixed.modified);
        assert_eq!((mixed.min, mixed.max), (120, 150));
        for value in ["120P", "120:150S", "120:150MSP"] {
            assert!(!parse_range(value).unwrap().complete);
        }
        for value in ["", "Unversioned directory", "150:120", "150X", "1:2:3"] {
            assert!(parse_range(value).is_none());
        }
    }
    #[test]
    fn history_presence_does_not_use_last_changed_revision_as_base() {
        let nodes = parse_nodes(
            r#"<info><entry path="a.txt" kind="file" revision="-1"><url>file:///r/dev/a.txt</url><wc-info><schedule>add</schedule></wc-info><commit revision="999"/></entry></info>"#,
        );
        assert_eq!(nodes[0].revision, None);
        assert_eq!(nodes[0].schedule, "add");
    }
    #[test]
    fn history_presence_rejects_escaping_paths_and_scope_prefix_collisions() {
        assert!(relative_path("/dev/../outside", "/dev", Path::new(".")).is_none());
        assert!(relative_path("/developer/a", "/dev", Path::new(".")).is_none());
        assert!(relative_path("/dev/.svn/wc.db", "/dev", Path::new(".")).is_none());
    }
}
