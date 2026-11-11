//! Revision menu operations. No history rewriting and no implicit local commit.
use crate::{svn, workflows as w};
use std::{
    fs,
    io::Write,
    path::{Component, Path},
};

async fn checked(path: &str, expected: &str) -> w::Result<w::Identity> {
    let info = w::identity(path).await?;
    if svn::info(path).await.map_err(|e| e.to_string())?.url != expected {
        return Err("Working-copy source changed; reopen this action".into());
    }
    Ok(info)
}
async fn at(path: &str, source: &str, revision: u64, uuid: &str) -> w::Result<crate::SvnInfo> {
    w::valid_url(source)?;
    if revision == 0 {
        return Err("Invalid revision".into());
    }
    // A log can follow copies/renames into older locations. Resolve the
    // operative revision using the current lineage before pinning its old URL.
    let first = w::run(
        path,
        &[
            "info",
            "--xml",
            "-r",
            &revision.to_string(),
            "--",
            &format!("{source}@HEAD"),
        ],
    )
    .await;
    let xml = match first {
        Ok(xml) => xml,
        Err(error) if error.contains("E160013") || error.contains("W170000") => {
            w::run(
                path,
                &[
                    "info",
                    "--xml",
                    "-r",
                    &revision.to_string(),
                    "--",
                    &format!("{source}@{revision}"),
                ],
            )
            .await?
        }
        Err(error) => return Err(error),
    };
    if w::field(&xml, "uuid") != uuid {
        return Err("Different repository UUID".into());
    }
    svn::parse_info_xml(&xml).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn history_copy(
    path: String,
    source: String,
    revision: u64,
    destination: String,
    message: String,
    expected_url: String,
) -> w::Result<String> {
    let _guard = w::acquire(&path).await?;
    let info = checked(&path, &expected_url).await?;
    let source_info = at(&path, &source, revision, &info.uuid).await?;
    if source_info.node_kind != "dir" {
        return Err("Branches and tags require a directory source".into());
    }
    let destination = w::valid_url(&destination)?
        .to_string()
        .trim_end_matches('/')
        .to_string();
    let base = info.repository_root.trim_end_matches('/');
    if !destination.starts_with(&format!("{base}/"))
        || destination == source.trim_end_matches('/')
        || destination.starts_with(&format!("{}/", source.trim_end_matches('/')))
        || destination == source_info.url
        || destination.starts_with(&format!("{}/", source_info.url.trim_end_matches('/')))
    {
        return Err("Choose a new URL in this repository, outside the source directory".into());
    }
    if message.trim().is_empty() {
        return Err("A repository commit message is required".into());
    }
    svn::copy_repository(&path, &source_info.url, revision, &destination, &message)
        .await
        .map_err(|e| e.to_string())
}

fn new_checkout_path(destination: &Path, current: &Path) -> w::Result<()> {
    if !destination.is_absolute()
        || destination
            .components()
            .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("Choose an absolute checkout directory".into());
    }
    for p in destination.ancestors() {
        if let Ok(meta) = fs::symlink_metadata(p) {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err("Reparse-point destinations are not supported".into());
                }
            }
            if meta.file_type().is_symlink() {
                return Err("Symbolic-link destinations are not supported".into());
            }
        }
        if p.join(".svn").exists() || p.join(".git").exists() {
            return Err(
                "Choose a directory outside existing working copies and Git repositories".into(),
            );
        }
    }
    if destination.starts_with(current) {
        return Err("Do not create a nested working copy".into());
    }
    if destination.exists()
        && (!destination.is_dir()
            || fs::read_dir(destination)
                .map_err(|e| e.to_string())?
                .next()
                .is_some())
    {
        return Err("Checkout destination must be empty or new".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn history_checkout(
    path: String,
    source: String,
    revision: u64,
    destination: String,
    expected_url: String,
) -> w::Result<String> {
    let _guard = w::acquire(&path).await?;
    let info = checked(&path, &expected_url).await?;
    let source_info = at(&path, &source, revision, &info.uuid).await?;
    if source_info.node_kind != "dir" {
        return Err("Checkout requires a directory source".into());
    }
    new_checkout_path(Path::new(&destination), Path::new(&info.root))?;
    w::run(
        &path,
        &[
            "checkout",
            "--ignore-externals",
            "-r",
            &revision.to_string(),
            "--",
            &format!("{}@{revision}", source_info.url),
            &destination,
        ],
    )
    .await
}

#[tauri::command]
pub async fn history_edit_message(
    path: String,
    source: String,
    revision: u64,
    previous: String,
    message: String,
    expected_url: String,
) -> w::Result<String> {
    let _guard = w::acquire(&path).await?;
    let info = checked(&path, &expected_url).await?;
    at(&path, &source, revision, &info.uuid).await?;
    if message.trim().is_empty() {
        return Err("Commit message must not be empty".into());
    }
    let revision = revision.to_string();
    let current = w::run(
        &path,
        &[
            "propget",
            "--revprop",
            "--strict",
            "-r",
            &revision,
            "svn:log",
            "--",
            &info.repository_root,
        ],
    )
    .await?;
    if current.replace("\r\n", "\n") != previous.replace("\r\n", "\n") {
        return Err("The log message changed on the server; reload before editing".into());
    }
    // The server's pre-revprop-change hook and permissions remain authoritative.
    w::run(
        &path,
        &[
            "propset",
            "--revprop",
            "-r",
            &revision,
            "--",
            "svn:log",
            &message,
            &info.repository_root,
        ],
    )
    .await
}

#[tauri::command]
pub async fn history_export_patches(
    path: String,
    source: String,
    revisions: Vec<u64>,
    destination: String,
    expected_url: String,
) -> w::Result<Vec<String>> {
    let _guard = w::acquire(&path).await?;
    let info = checked(&path, &expected_url).await?;
    let mut revisions = revisions;
    revisions.sort_unstable();
    revisions.dedup();
    if revisions.is_empty() || revisions.len() > 128 || revisions[0] == 0 {
        return Err("Select 1 to 128 valid revisions".into());
    }
    let last = *revisions.last().unwrap();
    let operative = at(&path, &source, last, &info.uuid).await?;
    let folder = Path::new(&destination);
    if !folder.is_absolute() || !folder.is_dir() {
        return Err("Choose an existing output folder".into());
    }
    let mut patches = Vec::new();
    let mut size = 0;
    for revision in revisions {
        let target = folder.join(format!("r{revision}.patch"));
        if target.exists() {
            return Err(format!("Output already exists: {}", target.display()));
        }
        let diff = w::run(
            &path,
            &[
                "diff",
                "-c",
                &revision.to_string(),
                "--",
                &format!("{}@{last}", operative.url),
            ],
        )
        .await?;
        if diff.contains('\u{FFFD}')
            || diff.contains('\0')
            || diff.lines().any(|line| {
                line.starts_with("Cannot display:") || line.starts_with("Binary files ")
            })
        {
            return Err("Binary or non-UTF-8 contents cannot be stored in a text patch; use a complete asset stash or file export".into());
        }
        size += diff.len();
        if diff.trim().is_empty() || size > 64 * 1024 * 1024 {
            return Err("Empty patch or selection exceeds 64 MiB".into());
        }
        patches.push((target, diff));
    }
    // Validate every patch before writing any, especially mixed text/binary sets.
    let mut output = Vec::new();
    for (target, diff) in patches {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&target)
            .map_err(|e| format!("Patch output failed; already created {output:?}: {e}"))?;
        file.write_all(diff.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        output.push(target.to_string_lossy().into_owned());
    }
    Ok(output)
}
