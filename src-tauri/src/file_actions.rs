//! Explicit file-menu actions. Repository writes happen only after a user action.
use crate::{svn, workflows as w};
use quick_xml::{events::Event, Reader};
use serde::Serialize;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

fn child(root: &Path, file: &str) -> w::Result<PathBuf> {
    if file == "." {
        Ok(root.to_path_buf())
    } else {
        w::safe_child(root, file)
    }
}
pub(crate) async fn owned(path: &str, file: &str) -> w::Result<PathBuf> {
    let workspace = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let full = child(&workspace, file)?;
    let identity = w::identity(path).await?;
    let root = fs::canonicalize(&identity.root).map_err(|e| e.to_string())?;
    let relative = full
        .strip_prefix(root)
        .map_err(|_| "Outside working copy")?
        .to_string_lossy()
        .replace('\\', "/");
    if !relative.is_empty() {
        w::ensure_owned(&identity.root, &relative).await?;
    }
    Ok(full)
}
fn binary_hint(path: &Path) -> w::Result<bool> {
    if !path.is_file() {
        return Ok(false);
    }
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = vec![0; 8192];
    let length = file.read(&mut bytes).map_err(|e| e.to_string())?;
    bytes.truncate(length);
    Ok(bytes.contains(&0) || std::str::from_utf8(&bytes).is_err_and(|e| e.error_len().is_some()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDetails {
    pub kind: String,
    pub exists: bool,
    pub binary: bool,
    pub size: u64,
    pub history_url: Option<String>,
}
#[tauri::command]
pub async fn workspace_item_details(path: String, file: String) -> w::Result<ItemDetails> {
    let full = owned(&path, &file).await?;
    let info = w::run(&path, &["info", "--xml", "--", &w::target(&file)])
        .await
        .ok()
        .and_then(|xml| svn::parse_info_xml(&xml).ok());
    let kind = if full.is_dir() {
        "dir".into()
    } else if full.is_file() {
        "file".into()
    } else {
        info.as_ref()
            .map(|i| i.node_kind.clone())
            .unwrap_or("missing".into())
    };
    Ok(ItemDetails {
        kind,
        exists: full.exists(),
        binary: binary_hint(&full)?,
        size: fs::metadata(&full).map(|meta| meta.len()).unwrap_or(0),
        history_url: info.and_then(|i| (i.revision > 0 && !i.url.is_empty()).then_some(i.url)),
    })
}
#[tauri::command]
pub async fn open_workspace_item(path: String, file: String) -> w::Result<()> {
    let full = owned(&path, &file).await?;
    if !full.exists() {
        return Err("The selected path no longer exists".into());
    }
    crate::open_file_manager(&full.to_string_lossy())
}

fn ignore_property(xml: &str) -> w::Result<String> {
    let mut reader = Reader::from_str(xml);
    let mut active = false;
    let mut value = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.name().as_ref() == b"property" => {
                active = e
                    .try_get_attribute("name")
                    .map_err(|e| e.to_string())?
                    .and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()))
                    .as_deref()
                    == Some("svn:ignore");
            }
            Ok(Event::Text(e)) if active => {
                value.push_str(&e.unescape().map_err(|e| e.to_string())?)
            }
            Ok(Event::CData(e)) if active => value.push_str(&String::from_utf8_lossy(&e)),
            Ok(Event::End(e)) if active && e.name().as_ref() == b"property" => return Ok(value),
            Ok(Event::Eof) => return Ok(value),
            Err(e) => return Err(e.to_string()),
            _ => {}
        }
    }
}
fn literal_pattern(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '[' => "[[]".into(),
            ']' => "[]]".into(),
            '*' => "[*]".into(),
            '?' => "[?]".into(),
            _ => c.to_string(),
        })
        .collect()
}
pub async fn ignore(
    path: &str,
    file: &str,
    by_extension: bool,
    expected_url: &str,
) -> w::Result<()> {
    let _guard = w::acquire(path).await?;
    let current = w::run(path, &["info", "--xml", "--", "."]).await?;
    if svn::parse_info_xml(&current)
        .map_err(|e| e.to_string())?
        .url
        != expected_url
    {
        return Err("Working-copy branch changed; open the menu again".into());
    }
    let full = owned(path, file).await?;
    let xml = w::run(
        path,
        &[
            "status",
            "--xml",
            "--no-ignore",
            "--depth",
            "empty",
            "--",
            &w::target(file),
        ],
    )
    .await?;
    let status = svn::parse_status_xml(&xml).map_err(|e| e.to_string())?;
    if !status.iter().any(|s| s.status_code == "unversioned") {
        return Err(
            "Only unversioned paths can be ignored; tracked changes remain visible to SVN".into(),
        );
    }
    let name = full
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?;
    if name.contains(['\n', '\r']) {
        return Err("This filename cannot be represented by an SVN ignore line".into());
    }
    let pattern = if by_extension {
        if !full.is_file() {
            return Err("Extension ignore requires a file".into());
        }
        let extension = full
            .extension()
            .and_then(|n| n.to_str())
            .filter(|n| !n.is_empty())
            .ok_or("The file has no extension")?;
        format!("*.{}", literal_pattern(extension))
    } else {
        literal_pattern(name)
    };
    let relative_parent = Path::new(file)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let parent = relative_parent.to_string_lossy().replace('\\', "/");
    let xml = w::run(
        path,
        &["proplist", "--xml", "--verbose", "--", &w::target(&parent)],
    )
    .await?;
    let mut value = ignore_property(&xml)?
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    if value.lines().any(|line| line == pattern) {
        return Ok(());
    }
    if !value.is_empty() && !value.ends_with('\n') {
        value.push('\n');
    }
    value.push_str(&pattern);
    value.push('\n');
    let temp = std::env::temp_dir().join(format!("orcasvn-ignore-{}", w::id()));
    let mut temporary = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| e.to_string())?;
    temporary
        .write_all(value.as_bytes())
        .and_then(|_| temporary.sync_all())
        .map_err(|e| e.to_string())?;
    drop(temporary);
    let result = w::run(
        path,
        &[
            "propset",
            "svn:ignore",
            "--file",
            &temp.to_string_lossy(),
            "--",
            &w::target(&parent),
        ],
    )
    .await;
    let _ = fs::remove_file(temp);
    result.map(|_| ())
}
#[tauri::command]
pub async fn ignore_workspace_item(
    path: String,
    file: String,
    by_extension: bool,
    expected_url: String,
) -> w::Result<()> {
    ignore(&path, &file, by_extension, &expected_url).await
}

pub async fn export_patch(
    path: &str,
    files: &[String],
    destination: &Path,
    expected_url: &str,
) -> w::Result<()> {
    let _guard = w::acquire(path).await?;
    let current = w::run(path, &["info", "--xml", "--", "."]).await?;
    if svn::parse_info_xml(&current)
        .map_err(|e| e.to_string())?
        .url
        != expected_url
    {
        return Err("Working-copy branch changed; open the menu again".into());
    }
    if files.is_empty() {
        return Err("Select changes to export".into());
    }
    if !destination
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("patch") || s.eq_ignore_ascii_case("diff"))
    {
        return Err("Choose a .patch or .diff filename".into());
    }
    let mut patch = String::new();
    for (index, file) in files.iter().enumerate() {
        let full = owned(path, file).await?;
        if binary_hint(&full)? {
            return Err(
                "Binary asset contents cannot be stored in a text patch; use a complete file stash"
                    .into(),
            );
        }
        if full.is_file() {
            let mut bytes = Vec::new();
            fs::File::open(&full)
                .map_err(|e| e.to_string())?
                .take(64 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > 64 * 1024 * 1024
                || bytes.contains(&0)
                || std::str::from_utf8(&bytes).is_err()
            {
                return Err(
                    "Use a complete file stash for binary, non-UTF-8 or very large files".into(),
                );
            }
        }
        let xml = w::run(
            path,
            &[
                "status",
                "--xml",
                "--depth",
                "empty",
                "--",
                &w::target(file),
            ],
        )
        .await?;
        let statuses = svn::parse_status_xml(&xml).map_err(|e| e.to_string())?;
        if full.is_dir() && statuses.iter().any(|s| s.status_code == "unversioned") {
            return Err("Use a complete file stash for unversioned directories".into());
        }
        w::progress("patch-export", file, index, files.len());
        let text = if statuses.iter().any(|s| s.status_code == "unversioned") {
            svn::diff(path, file, None, None)
                .await
                .map_err(|e| e.to_string())?
                .diff
        } else {
            let diff_target = if file.contains('@') {
                format!("{file}@")
            } else {
                file.clone()
            };
            w::run(path, &["diff", "--depth", "empty", "--", &diff_target]).await?
        };
        if text.contains("Cannot display:") || text.contains('\0') {
            return Err("The selection includes binary changes; use a complete file stash".into());
        }
        patch.push_str(&text);
        if patch.len() > 64 * 1024 * 1024 {
            return Err(
                "Patch exceeds 64 MiB; export a smaller selection or use a complete stash".into(),
            );
        }
    }
    if patch.trim().is_empty() {
        return Err("There are no text changes to export".into());
    }
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|e| format!("Choose a new output filename: {e}"))?;
    let result = output
        .write_all(patch.as_bytes())
        .and_then(|_| output.sync_all());
    drop(output);
    if let Err(error) = result {
        let _ = fs::remove_file(destination);
        return Err(error.to_string());
    }
    Ok(())
}
#[tauri::command]
pub async fn export_workspace_patch(
    path: String,
    files: Vec<String>,
    destination: String,
    expected_url: String,
) -> w::Result<()> {
    export_patch(&path, &files, Path::new(&destination), &expected_url).await
}
