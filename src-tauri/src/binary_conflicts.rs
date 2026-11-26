//! Automatic conflict resolution for generated binaries and Unreal module manifests.
//! Backs up each conflict before applying the selected version.
use crate::workflows as w;
use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::Read, path::Path};

const MAX_BATCH: usize = 8;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ResolutionSide {
    Local,
    Incoming,
}

fn in_binaries(path: &str) -> bool {
    let parts: Vec<_> = path.split(['/', '\\']).collect();
    parts.len() > 1
        && !parts
            .iter()
            .any(|part| part.is_empty() || *part == "." || *part == "..")
        && parts[..parts.len() - 1]
            .iter()
            .any(|part| part.eq_ignore_ascii_case("Binaries"))
}

fn mime_type(xml: &str) -> w::Result<String> {
    let mut reader = Reader::from_str(xml);
    let mut selected = false;
    let mut mime = String::new();
    loop {
        match reader.read_event().map_err(|e| e.to_string())? {
            Event::Start(e) if e.name().as_ref() == b"property" => {
                selected = e.attributes().flatten().any(|attr| {
                    attr.key.as_ref() == b"name" && attr.value.as_ref() == b"svn:mime-type"
                });
            }
            Event::Text(text) if selected => {
                mime.push_str(&text.unescape().map_err(|e| e.to_string())?)
            }
            Event::End(e) if e.name().as_ref() == b"property" => selected = false,
            Event::Eof => return Ok(mime),
            _ => {}
        }
    }
}

fn has_conflict_markers(bytes: &[u8]) -> bool {
    bytes
        .split(|byte| *byte == b'\n')
        .any(|line| line.starts_with(b"<<<<<<< "))
}

fn module_resolution(root: &Path, full: &Path, conflict: &w::Conflict) -> w::Result<&'static str> {
    let working = fs::read(full).map_err(|error| error.to_string())?;
    if !has_conflict_markers(&working) {
        return Ok("working");
    }
    // SVN inserts markers into text conflicts. Acknowledging those bytes
    // would leave the generated manifest unusable.
    let local = conflict
        .versions
        .iter()
        .find(|version| version.side == "local")
        .filter(|_| conflict.kind != "tree")
        .ok_or("Cannot restore the local .modules version from its conflict artifacts")?;
    let local = w::safe_child(root, &local.path)?;
    let bytes = fs::read(local).map_err(|error| error.to_string())?;
    if has_conflict_markers(&bytes) {
        return Err("The local .modules version already contains conflict markers".into());
    }
    Ok("mine-full")
}

async fn automatic_resolution(
    info: &w::Identity,
    conflict: &w::Conflict,
    side: ResolutionSide,
) -> w::Result<Option<(&'static str, String)>> {
    if !conflict.summary.as_ref().is_some_and(|s| {
        s.node_kind == "file"
            && ["normal", "add", "replace"].contains(&s.schedule.as_str())
            && s.incoming
                .as_ref()
                .is_none_or(|source| source.kind != "dir")
            && s.base.as_ref().is_none_or(|source| source.kind != "dir")
    }) {
        return Ok(None);
    }
    // Replacing file contents cannot safely resolve tree or property conflicts.
    if matches!(side, ResolutionSide::Incoming) && conflict.kind != "content" {
        return Ok(None);
    }
    let root = Path::new(&info.root);
    let full = w::safe_child(root, &conflict.path)?;
    if !full.is_file() {
        return Ok(None);
    }
    let xml = w::run(
        &info.root,
        &[
            "proplist",
            "--xml",
            "--verbose",
            "--",
            &w::target(&conflict.path),
        ],
    )
    .await?;
    let modules = full
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("modules"));
    if !modules && !is_binary(&full, &xml)? {
        return Ok(None);
    }

    let strategy = match side {
        ResolutionSide::Local if modules => module_resolution(root, &full, conflict)?,
        ResolutionSide::Local => "working",
        ResolutionSide::Incoming => {
            // Use the version recorded for this conflict, which may differ from HEAD.
            let incoming = conflict
                .versions
                .iter()
                .find(|version| version.side == "incoming")
                .ok_or("Incoming conflict artifact is unavailable")?;
            let incoming = w::safe_child(root, &incoming.path)?;
            if !incoming.is_file() {
                return Err("Incoming conflict artifact is unavailable".into());
            }
            if modules && has_conflict_markers(&fs::read(incoming).map_err(|e| e.to_string())?) {
                return Err(
                    "The incoming .modules version already contains conflict markers".into(),
                );
            }
            "theirs-full"
        }
    };
    Ok(Some((strategy, xml)))
}

fn is_binary(full: &Path, properties: &str) -> w::Result<bool> {
    let mime = mime_type(properties)?.trim().to_ascii_lowercase();
    if !mime.is_empty() {
        // Match SVN's binary MIME rule, including its two text exceptions.
        return Ok(!mime.starts_with("text/")
            && mime != "image/x-xbitmap"
            && mime != "image/x-xpixmap");
    }
    let mut bytes = Vec::new();
    fs::File::open(full)
        .map_err(|e| e.to_string())?
        .take(8192)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    // Keep UTF-16/32 text manual even though it contains NUL bytes.
    if bytes.starts_with(&[0xff, 0xfe])
        || bytes.starts_with(&[0xfe, 0xff])
        || bytes.starts_with(&[0, 0, 0xfe, 0xff])
    {
        return Ok(false);
    }
    Ok(bytes.contains(&0) || std::str::from_utf8(&bytes).is_err_and(|e| e.error_len().is_some()))
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchResult {
    pub(crate) resolved: Vec<String>,
    pub(crate) failures: BTreeMap<String, String>,
    pub(crate) status: Option<crate::svn::StatusPatch>,
    pub(crate) verification_failed: bool,
}

async fn exact_status(
    root: &str,
    targets: &[String],
) -> w::Result<BTreeMap<String, crate::SvnStatus>> {
    let mut args = vec![
        "status",
        "--xml",
        "--ignore-externals",
        "--depth",
        "empty",
        "--",
    ];
    args.extend(targets.iter().map(String::as_str));
    let xml = w::run(root, &args).await?;
    Ok(crate::svn::parse_status_xml(&xml)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|entry| (entry.path.clone(), entry))
        .collect())
}

fn conflicted(entry: &crate::SvnStatus) -> bool {
    entry.status_code == "conflicted" || entry.prop_status == "conflicted"
}

pub(crate) async fn resolve_batch(
    data: &Path,
    path: &str,
    files: &[String],
    expected_url: &str,
    side: ResolutionSide,
) -> w::Result<BatchResult> {
    if files.is_empty() || files.len() > MAX_BATCH {
        return Err("Invalid automatic resolution batch size".into());
    }
    let info = w::identity(path).await?;
    let _writer = w::acquire_identity(&info)?;
    let workspace = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let root = fs::canonicalize(&info.root).map_err(|e| e.to_string())?;
    let prefix = workspace
        .strip_prefix(&root)
        .map_err(|_| "Outside working copy")?;
    let workspace_url = if prefix.as_os_str().is_empty() {
        info.url.clone()
    } else {
        crate::svn::info(path).await.map_err(|e| e.to_string())?.url
    };
    if workspace_url != expected_url {
        return Err("Working-copy branch changed".into());
    }
    let mut result = BatchResult::default();
    let mut candidates = BTreeMap::new();
    for file in files {
        match w::safe_child(&workspace, file) {
            Ok(full) if full.is_file() => {
                let relative = prefix.join(file).to_string_lossy().replace('\\', "/");
                if in_binaries(&relative) {
                    candidates.insert(relative, file.clone());
                }
            }
            Ok(_) => {}
            Err(error) => {
                result.failures.insert(file.clone(), error);
            }
        }
    }
    if candidates.is_empty() {
        return Ok(result);
    }
    let targets: Vec<_> = candidates.keys().map(|file| w::target(file)).collect();
    let before = exact_status(&info.root, &targets).await?;
    let mut prepared = BTreeMap::new();
    for (relative, file) in &candidates {
        let Some(entry) = before.get(relative).filter(|entry| conflicted(entry)) else {
            continue;
        };
        let prepare = async {
            let current = w::inspect_conflict(&info, entry, false).await?;
            let Some((strategy, properties)) = automatic_resolution(&info, &current, side).await?
            else {
                return Ok(None);
            };
            let data = data.to_path_buf();
            let info = info.clone();
            tokio::task::spawn_blocking(move || {
                w::resolution_backup(&data, &info, &current, strategy, Some(&properties))
            })
            .await
            .map_err(|e| e.to_string())??;
            Ok(Some(strategy))
        };
        match prepare.await {
            Ok(Some(strategy)) => {
                prepared.insert(relative.clone(), strategy);
            }
            Ok(None) => {}
            Err(error) => {
                result.failures.insert(file.clone(), error);
            }
        }
    }
    if prepared.is_empty() {
        return Ok(result);
    }
    // Recheck the source after backups, immediately before acknowledging
    // conflicts. The writer prevents an in-app switch between these steps.
    verify_source(path, &info, expected_url, prefix.as_os_str().is_empty()).await?;
    let targets: Vec<_> = prepared.keys().map(|file| w::target(file)).collect();
    let mut errors = BTreeMap::new();
    for strategy in ["working", "mine-full", "theirs-full"] {
        let selected: Vec<_> = prepared
            .iter()
            .filter(|(_, accept)| **accept == strategy)
            .map(|(file, _)| w::target(file))
            .collect();
        if !selected.is_empty() {
            let mut args = vec!["resolve", "--accept", strategy, "--depth", "empty", "--"];
            args.extend(selected.iter().map(String::as_str));
            if let Err(error) = w::run(&info.root, &args).await {
                errors.insert(strategy, error);
            }
        }
    }
    let verification = async {
        let after = exact_status(&info.root, &targets).await?;
        verify_source(path, &info, expected_url, prefix.as_os_str().is_empty()).await?;
        Ok::<_, String>(after)
    };
    let after = match verification.await {
        Ok(after) => after,
        Err(error) => {
            result.verification_failed = true;
            let _ = crate::svn::invalidate_status(&workspace);
            for relative in prepared.keys() {
                result
                    .failures
                    .insert(candidates[relative].clone(), error.clone());
            }
            return Ok(result);
        }
    };
    let mut patch = crate::svn::StatusPatch {
        workspace: path.into(),
        expected_url: expected_url.into(),
        paths: Vec::new(),
        subtrees: Vec::new(),
        entries: Vec::new(),
    };
    for (relative, strategy) in prepared {
        let file = &candidates[&relative];
        let entry = after.get(&relative);
        if entry.is_some_and(conflicted) {
            result.failures.insert(
                file.clone(),
                errors
                    .get(strategy)
                    .cloned()
                    .unwrap_or_else(|| "Conflict is still present".into()),
            );
        } else {
            result.resolved.push(file.clone());
        }
        patch.paths.push(file.clone());
        if let Some(entry) = entry.filter(|entry| {
            !matches!(entry.status_code.as_str(), "normal" | "none")
                || matches!(entry.prop_status.as_str(), "modified" | "conflicted")
        }) {
            let mut entry = entry.clone();
            entry.path = file.clone();
            patch.entries.push(entry);
        }
    }
    result.status = Some(patch);
    Ok(result)
}

async fn verify_source(
    path: &str,
    info: &w::Identity,
    expected_url: &str,
    at_root: bool,
) -> w::Result<()> {
    let now = w::identity(path).await?;
    if now.uuid != info.uuid || now.root != info.root || now.url != info.url {
        return Err("Working-copy branch changed during resolution".into());
    }
    if !at_root && crate::svn::info(path).await.map_err(|e| e.to_string())?.url != expected_url {
        return Err("Working-copy source changed during resolution".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn repository_resolve_binaries(
    app: tauri::AppHandle,
    path: String,
    files: Vec<String>,
    expected_url: String,
    side: ResolutionSide,
) -> w::Result<BatchResult> {
    resolve_batch(&w::data_dir(&app)?, &path, &files, &expected_url, side).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_directory_components_only() {
        for path in [
            "Binaries/Win64/a.dll",
            "Plugins/P/Binaries/Linux/a.so",
            "binaries\\a.bin",
        ] {
            assert!(in_binaries(path));
        }
        for path in [
            "Binaries",
            "BinariesOld/a.dll",
            "Content/a.dll",
            "Binaries/../Content/a.dll",
            "/Binaries/a.dll",
        ] {
            assert!(!in_binaries(path));
        }
        assert_eq!(mime_type("<properties><property name=\"other\">text/plain</property><property name=\"svn:mime-type\">application/octet-stream</property></properties>").unwrap(), "application/octet-stream");
    }
}
