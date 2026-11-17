//! Structured, read-only conflict explanations and explicit directory previews.
use crate::workflows as w;
use quick_xml::{
    events::{BytesStart, Event},
    Reader,
};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub url: String,
    pub revision: u64,
    pub kind: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    #[serde(default)]
    pub tree_conflict: bool,
    pub node_kind: String,
    pub schedule: String,
    pub exists: bool,
    pub local_kind: String,
    pub operation: String,
    pub action: String,
    pub reason: String,
    pub base: Option<Source>,
    pub incoming: Option<Source>,
}
fn attr(e: &BytesStart<'_>, name: &str) -> w::Result<String> {
    e.try_get_attribute(name)
        .map_err(|e| e.to_string())?
        .map(|a| {
            a.unescape_value()
                .map(|v| v.into_owned())
                .map_err(|e| e.to_string())
        })
        .transpose()
        .map(|s| s.unwrap_or_default())
}
pub fn summary(xml: &str, working: &Path) -> w::Result<Summary> {
    let mut result = Summary {
        schedule: w::field(xml, "schedule"),
        exists: working.try_exists().map_err(|e| e.to_string())?,
        ..Summary::default()
    };
    result.local_kind = if working.is_dir() {
        "dir"
    } else if working.is_file() {
        "file"
    } else if result.exists {
        "other"
    } else {
        "missing"
    }
    .into();
    let mut reader = Reader::from_str(xml);
    let mut conflict = false;
    let mut current_tree = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.name().as_ref() {
                b"entry" => result.node_kind = attr(&e, "kind")?,
                b"tree-conflict" | b"conflict" => {
                    conflict = true;
                    current_tree = e.name().as_ref() == b"tree-conflict";
                    if current_tree {
                        result.tree_conflict = true;
                        result.base = None;
                        result.incoming = None;
                    }
                    if current_tree || !result.tree_conflict {
                        result.operation = attr(&e, "operation")?;
                        result.action = attr(&e, "action")?;
                        result.reason = attr(&e, "reason")?;
                    }
                }
                b"version" if conflict && (current_tree || !result.tree_conflict) => {
                    let revision = attr(&e, "revision")?.parse::<u64>().ok();
                    let repository = attr(&e, "repos-url")?;
                    let relative = attr(&e, "path-in-repos")?;
                    if let (Some(revision), Ok(mut url)) = (revision, w::valid_url(&repository)) {
                        if let Ok(mut segments) = url.path_segments_mut() {
                            segments.pop_if_empty();
                            for part in relative
                                .trim_matches('/')
                                .split('/')
                                .filter(|p| !p.is_empty())
                            {
                                segments.push(part);
                            }
                        }
                        let source = Source {
                            url: url.to_string(),
                            revision,
                            kind: attr(&e, "kind")?,
                        };
                        match attr(&e, "side")?.as_str() {
                            "source-left" => result.base = Some(source),
                            "source-right" => result.incoming = Some(source),
                            _ => {}
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::End(e))
                if [b"tree-conflict".as_slice(), b"conflict".as_slice()]
                    .contains(&e.name().as_ref()) =>
            {
                conflict = false;
                current_tree = false;
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(e.to_string()),
            _ => {}
        }
    }
    Ok(result)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Child {
    pub name: String,
    pub kind: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Children {
    pub entries: Vec<Child>,
    pub truncated: bool,
}
const CHILD_LIMIT: usize = 200;

#[tauri::command]
pub async fn conflict_children(path: String, file: String, side: String) -> w::Result<Children> {
    let detail = w::repository_conflict_detail(path.clone(), file.clone()).await?;
    let conflict = detail.conflict.ok_or("Conflict no longer exists")?;
    let summary = conflict.summary.ok_or("Conflict metadata is unavailable")?;
    let mut entries = Vec::new();
    if side == "local" {
        let full = if conflict.path == "." {
            std::path::PathBuf::from(&detail.identity.root)
        } else {
            w::safe_child(Path::new(&detail.identity.root), &conflict.path)?
        };
        for entry in fs::read_dir(full).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if [".svn", ".git"].contains(&name.as_str()) {
                continue;
            }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            entries.push(Child {
                name,
                kind: if kind.is_dir() {
                    "dir"
                } else if kind.is_file() {
                    "file"
                } else {
                    "other"
                }
                .into(),
            });
            if entries.len() > CHILD_LIMIT {
                break;
            }
        }
    } else if side == "incoming" {
        let source = summary
            .incoming
            .filter(|s| s.kind == "dir")
            .ok_or("Incoming directory metadata is unavailable")?;
        let xml = w::run(
            &path,
            &[
                "list",
                "--xml",
                "-r",
                &source.revision.to_string(),
                "--",
                &format!("{}@{}", source.url, source.revision),
            ],
        )
        .await?;
        let mut reader = Reader::from_str(&xml);
        let mut kind = String::new();
        let mut name = String::new();
        let mut in_name = false;
        loop {
            match reader.read_event() {
                Ok(Event::Start(e)) if e.name().as_ref() == b"entry" => {
                    kind = attr(&e, "kind")?;
                    name.clear();
                }
                Ok(Event::Start(e)) if e.name().as_ref() == b"name" => in_name = true,
                Ok(Event::Text(e)) if in_name => {
                    name.push_str(&e.unescape().map_err(|e| e.to_string())?)
                }
                Ok(Event::End(e)) if e.name().as_ref() == b"name" => in_name = false,
                Ok(Event::End(e)) if e.name().as_ref() == b"entry" => {
                    entries.push(Child {
                        name: name.clone(),
                        kind: kind.clone(),
                    });
                    if entries.len() > CHILD_LIMIT {
                        break;
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(e.to_string()),
                _ => {}
            }
        }
    } else {
        return Err("Unsupported conflict preview side".into());
    }
    let truncated = entries.len() > CHILD_LIMIT;
    entries.truncate(CHILD_LIMIT);
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Children { entries, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tree_explanation_keeps_recorded_reason_separate_from_current_schedule() {
        let xml = r#"<info><entry kind="dir"><url>https://example.invalid/repo/tree-conflict-name</url><wc-info><schedule>delete</schedule></wc-info><tree-conflict operation="update" action="add" reason="unversioned" kind="dir"><version side="source-left" repos-url="https://example.invalid/repo" path-in-repos="branches/dev/Settings &amp; Tools" revision="20" kind="none"/><version side="source-right" repos-url="https://example.invalid/repo" path-in-repos="branches/dev/Settings &amp; Tools" revision="21" kind="dir"/></tree-conflict></entry></info>"#;
        let absent = std::env::temp_dir().join(format!("conflict-summary-{}", w::id()));
        let result = summary(xml, &absent).unwrap();
        assert!(result.tree_conflict);
        assert_eq!(result.node_kind, "dir");
        assert_eq!(result.schedule, "delete");
        assert_eq!(result.reason, "unversioned");
        assert_eq!(result.action, "add");
        assert_eq!(result.operation, "update");
        assert!(!result.exists);
        assert_eq!(result.local_kind, "missing");
        let incoming = result.incoming.unwrap();
        assert_eq!(incoming.revision, 21);
        assert_eq!(
            incoming.url,
            "https://example.invalid/repo/branches/dev/Settings%20&%20Tools"
        );
        let false_positive=summary("<info><entry kind=\"file\"><url>https://example.invalid/tree-conflict</url></entry></info>",&absent).unwrap();
        assert!(!false_positive.tree_conflict);
    }
    #[test]
    fn incomplete_metadata_stays_unknown_and_old_conflict_records_still_load() {
        let absent = std::env::temp_dir().join(format!("conflict-summary-{}", w::id()));
        let result=summary(r#"<info><entry kind="file"><conflict operation="merge"><version side="source-right" revision="invalid" repos-url="https://example.invalid/repo"/></conflict></entry></info>"#,&absent).unwrap();
        assert_eq!(result.operation, "merge");
        assert!(result.action.is_empty());
        assert!(result.incoming.is_none());
        let old: w::Conflict = serde_json::from_str(
            r#"{"path":"file.txt","kind":"content","details":"","versions":[]}"#,
        )
        .unwrap();
        assert!(old.summary.is_none());
    }
}
