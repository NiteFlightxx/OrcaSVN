//! Explicit, shell-free external tools. Diff inputs are snapshots; only the merge
//! result argument may point at a working file. Resolving remains a separate action.
use crate::{file_actions, workflows as w};
use std::{collections::HashMap, fs, path::Path};
use tauri::Manager;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintReviewReport {
    info: String,
    report: Option<String>,
    detail: Option<String>,
}

fn blueprintreview_cli() -> w::Result<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(Path::new(&local).join("Programs/BlueprintReview/blueprintreview.exe"));
    }
    if let Some(programs) = std::env::var_os("ProgramFiles") {
        candidates.push(Path::new(&programs).join("BlueprintReview/blueprintreview.exe"));
    }
    candidates
        .into_iter()
        .find(|path| path.is_absolute() && path.is_file())
        .ok_or_else(|| {
            "BlueprintReview CLI is not installed in a standard Windows installation directory"
                .into()
        })
}

async fn blueprintreview_output(
    program: &Path,
    args: &[&str],
    directory: &Path,
) -> w::Result<String> {
    let mut command = tokio::process::Command::new(program);
    command.args(args).current_dir(directory).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(std::time::Duration::from_secs(30), command.output())
        .await
        .map_err(|_| "BlueprintReview timed out".to_owned())?
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(if detail.trim().is_empty() {
            format!("BlueprintReview exited with {}", output.status)
        } else {
            detail.trim().to_owned()
        });
    }
    if output.stdout.len() > 2_000_000 {
        return Err("BlueprintReview report exceeds 2 MB".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

pub(crate) async fn blueprintreview_report(
    path: &str,
    file: &str,
    expected_url: &str,
    directory: &Path,
    program: &Path,
) -> w::Result<BlueprintReviewReport> {
    let _guard = w::acquire(path).await?;
    if w::identity(path).await?.url != expected_url {
        return Err("Working-copy branch changed".into());
    }
    let full = file_actions::owned(path, file).await?;
    if !full.is_file()
        || !full.extension().is_some_and(|ext| {
            ext.eq_ignore_ascii_case("uasset") || ext.eq_ignore_ascii_case("umap")
        })
    {
        return Err("Select an existing Unreal asset".into());
    }
    // Work on private copies. The external viewer must never write to the actual working file.
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let result = async {
        let working = directory.join("working");
        fs::create_dir(&working).map_err(|error| error.to_string())?;
        let right = working.join(full.file_name().ok_or("Invalid asset name")?);
        fs::copy(&full, &right).map_err(|error| error.to_string())?;
        let info =
            blueprintreview_output(program, &["info", &right.to_string_lossy()], directory).await?;
        if info.lines().any(|line| {
            line.trim_start().starts_with("contains:") && line.contains("(not supported)")
        }) {
            return Ok(BlueprintReviewReport {
                info,
                report: None,
                detail: None,
            });
        }
        let left_dir = directory.join("base");
        fs::create_dir(&left_dir).map_err(|error| error.to_string())?;
        let left = left_dir.join(full.file_name().ok_or("Invalid asset name")?);
        let comparison = async {
            w::run(
                path,
                &[
                    "export",
                    "-r",
                    "BASE",
                    "--",
                    &w::target(file),
                    &left.to_string_lossy(),
                ],
            )
            .await?;
            blueprintreview_output(
                program,
                &[
                    "diff",
                    &left.to_string_lossy(),
                    &right.to_string_lossy(),
                    "--format",
                    "md",
                ],
                directory,
            )
            .await
        }
        .await;
        let (report, detail) = match comparison {
            Ok(report) => (Some(report), None),
            Err(detail) => (None, Some(detail)),
        };
        Ok(BlueprintReviewReport {
            info,
            report,
            detail,
        })
    }
    .await;
    let _ = fs::remove_dir_all(directory);
    result
}

#[tauri::command]
pub async fn workspace_blueprintreview_report(
    app: tauri::AppHandle,
    path: String,
    file: String,
    expected_url: String,
) -> w::Result<BlueprintReviewReport> {
    let program = blueprintreview_cli()?;
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("blueprintreview")
        .join(w::id());
    blueprintreview_report(&path, &file, &expected_url, &directory, &program).await
}

fn expand_arguments(args: &[String], files: &HashMap<&str, String>) -> w::Result<Vec<String>> {
    if args.len() > 64 {
        return Err("Too many tool arguments".into());
    }
    args.iter()
        .map(|arg| {
            let mut result = String::new();
            let mut remaining = arg.as_str();
            while let Some(start) = remaining.find('{') {
                result.push_str(&remaining[..start]);
                let end = remaining[start..]
                    .find('}')
                    .ok_or("Unclosed tool placeholder")?
                    + start;
                let key = &remaining[start + 1..end];
                result.push_str(
                    files
                        .get(key)
                        .ok_or_else(|| format!("Unknown tool placeholder: {key}"))?,
                );
                remaining = &remaining[end + 1..];
            }
            result.push_str(remaining);
            Ok(result)
        })
        .collect()
}

#[tauri::command]
pub async fn workspace_properties(path: String, file: String) -> w::Result<String> {
    file_actions::owned(&path, &file).await?;
    w::run(
        &path,
        &[
            "diff",
            "--properties-only",
            "--depth",
            "empty",
            "--",
            &w::target(&file),
        ],
    )
    .await
}

#[tauri::command]
pub async fn workspace_compare(
    path: String,
    source: String,
    old: u64,
    new: Option<u64>,
    working: bool,
) -> w::Result<String> {
    if working {
        return w::run(&path, &["diff", "-r", &old.to_string(), "--", "."]).await;
    }
    w::valid_url(&source)?;
    let revision = new.ok_or("A target revision is required")?;
    w::run(
        &path,
        &[
            "diff",
            "-r",
            &format!("{old}:{revision}"),
            "--",
            &format!("{source}@{revision}"),
        ],
    )
    .await
}

pub(crate) async fn prepare_inputs(
    path: &str,
    file: &str,
    merge: bool,
    directory: &Path,
) -> w::Result<HashMap<&'static str, String>> {
    let identity = w::identity(path).await?;
    let full = file_actions::owned(path, file).await?;
    let mut files = HashMap::new();
    if merge {
        let canonical_root = fs::canonicalize(&identity.root).map_err(|e| e.to_string())?;
        let relative = full
            .strip_prefix(&canonical_root)
            .map_err(|_| "Outside working copy")?
            .to_string_lossy()
            .replace('\\', "/");
        let conflict = w::repository_conflicts(identity.root.clone())
            .await?
            .into_iter()
            .find(|item| item.path == relative && item.kind == "content")
            .ok_or("Select a content conflict")?;
        for side in ["base", "mine", "theirs"] {
            let version_side = match side {
                "mine" => "local",
                "theirs" => "incoming",
                _ => side,
            };
            let version = conflict
                .versions
                .iter()
                .find(|v| v.side == version_side)
                .ok_or_else(|| format!("Missing {side} conflict version"))?;
            let original = w::safe_child(Path::new(&identity.root), &version.path)?;
            let side_directory = directory.join(side);
            fs::create_dir(&side_directory).map_err(|e| e.to_string())?;
            let snapshot = side_directory.join(full.file_name().ok_or("Invalid filename")?);
            fs::copy(original, &snapshot).map_err(|e| e.to_string())?;
            files.insert(side, snapshot.to_string_lossy().into_owned());
        }
        files.insert("merged", full.to_string_lossy().into_owned());
    } else {
        let left_directory = directory.join("base");
        let right_directory = directory.join("working");
        fs::create_dir(&left_directory).map_err(|e| e.to_string())?;
        fs::create_dir(&right_directory).map_err(|e| e.to_string())?;
        let left = left_directory.join(full.file_name().ok_or("Invalid filename")?);
        let right = right_directory.join(full.file_name().ok_or("Invalid filename")?);
        w::run(
            path,
            &[
                "export",
                "-r",
                "BASE",
                "--",
                &w::target(file),
                &left.to_string_lossy(),
            ],
        )
        .await?;
        fs::copy(&full, &right).map_err(|e| e.to_string())?;
        files.insert("left", left.to_string_lossy().into_owned());
        files.insert("right", right.to_string_lossy().into_owned());
    }
    Ok(files)
}

#[tauri::command]
pub async fn workspace_external_tool(
    app: tauri::AppHandle,
    path: String,
    file: String,
    executable: String,
    args: Vec<String>,
    merge: bool,
    expected_url: String,
) -> w::Result<()> {
    let _guard = w::acquire(&path).await?;
    let identity = w::identity(&path).await?;
    if identity.url != expected_url {
        return Err("Working-copy branch changed".into());
    }
    let full = file_actions::owned(&path, &file).await?;
    if !full.is_file() {
        return Err("Select an existing file".into());
    }
    let program = Path::new(&executable);
    if !program.is_absolute() || !program.is_file() {
        return Err("Select an absolute executable path".into());
    }
    #[cfg(windows)]
    if !program
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    {
        return Err("Select a native .exe tool, not a shell script".into());
    }
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("external-tools")
        .join(w::id());
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let mut launched = false;
    let result: w::Result<()> = async {
        let files = prepare_inputs(&path, &file, merge, &directory).await?;
        let arguments = expand_arguments(&args, &files)?;
        launched = true;
        let status = tokio::process::Command::new(&executable)
            .args(arguments)
            .current_dir(&path)
            .status()
            .await
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("External tool exited with {status}"));
        }
        Ok(())
    }
    .await;
    // Single-instance launchers may return before the existing process opens the
    // inputs. Retain explicitly requested comparison inputs in the app cache.
    if !launched {
        let _ = fs::remove_dir_all(directory);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn arguments_preserve_spaces_and_metacharacters_without_recursive_expansion() {
        let files = HashMap::from([
            ("left", "C:/test/$x & {right}.uasset".into()),
            ("right", "C:/two files".into()),
        ]);
        assert_eq!(
            expand_arguments(&["--left={left}".into(), "{right}".into()], &files).unwrap(),
            ["--left=C:/test/$x & {right}.uasset", "C:/two files"]
        );
        assert!(expand_arguments(&["{missing}".into()], &files).is_err());
        assert!(expand_arguments(&["{left".into()], &files).is_err());
    }
}
