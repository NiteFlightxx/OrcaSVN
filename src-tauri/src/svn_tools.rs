use crate::{file_actions, svn, workflows as w};
use serde::Deserialize;
use std::{collections::BTreeSet, fs, path::Path};

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Action {
    Info {
        target: String,
    },
    Properties {
        target: String,
    },
    RemoteStatus {
        target: String,
    },
    Add {
        target: String,
    },
    Delete {
        target: String,
    },
    Copy {
        target: String,
        destination: String,
    },
    Move {
        target: String,
        destination: String,
    },
    Mkdir {
        target: String,
    },
    Lock {
        target: String,
        message: String,
    },
    Unlock {
        target: String,
    },
    SetProperty {
        target: String,
        name: String,
        value: String,
    },
    DeleteProperty {
        target: String,
        name: String,
    },
    Changelist {
        target: String,
        name: String,
    },
    RemoveChangelist {
        target: String,
    },
    Cleanup,
    Export {
        source: String,
        destination: String,
        revision: Option<u64>,
    },
    Import {
        source: String,
        destination: String,
        message: String,
    },
    RemoteMkdir {
        destination: String,
        message: String,
    },
    Patch {
        source: String,
        reverse: bool,
    },
    Mergeinfo {
        source: String,
    },
}

impl Action {
    fn writer(&self) -> bool {
        !matches!(
            self,
            Self::Info { .. }
                | Self::Properties { .. }
                | Self::RemoteStatus { .. }
                | Self::Export { .. }
                | Self::Mergeinfo { .. }
        )
    }

    fn target(&self) -> Option<&str> {
        match self {
            Self::Info { target }
            | Self::Properties { target }
            | Self::RemoteStatus { target }
            | Self::Add { target }
            | Self::Delete { target }
            | Self::Copy { target, .. }
            | Self::Move { target, .. }
            | Self::Mkdir { target }
            | Self::Lock { target, .. }
            | Self::Unlock { target }
            | Self::SetProperty { target, .. }
            | Self::DeleteProperty { target, .. }
            | Self::Changelist { target, .. }
            | Self::RemoveChangelist { target } => Some(target),
            _ => None,
        }
    }
}

fn existing_parent(path: &Path) -> w::Result<&Path> {
    path.parent()
        .filter(|parent| parent.is_dir())
        .ok_or_else(|| "Destination parent does not exist".into())
}

fn require_absent(path: &Path) -> w::Result<()> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Ok(_) => Err(format!("Destination already exists: {}", path.display())),
        Err(error) => Err(error.to_string()),
    }
}

fn check_name(name: &str) -> w::Result<()> {
    if name.is_empty() || name.chars().any(char::is_whitespace) {
        return Err("Enter a nonempty SVN name with no spaces".into());
    }
    Ok(())
}

fn same_repository(identity: &w::Identity, source: &str) -> w::Result<url::Url> {
    let url = w::valid_url(source)?;
    let root = w::valid_url(&identity.repository_root)?;
    let root_path = root.path().trim_end_matches('/');
    if url.scheme() != root.scheme()
        || url.host_str() != root.host_str()
        || url.port_or_known_default() != root.port_or_known_default()
        || !(url.path().trim_end_matches('/') == root_path
            || url
                .path()
                .strip_prefix(root_path)
                .is_some_and(|suffix| suffix.starts_with('/')))
    {
        return Err("The URL must belong to the current SVN repository".into());
    }
    Ok(url)
}

async fn remote_destination(
    path: &str,
    identity: &w::Identity,
    value: &str,
    message: &str,
) -> w::Result<String> {
    if message.trim().is_empty() {
        return Err("Enter a commit message".into());
    }
    let mut destination = same_repository(identity, value)?;
    let root = w::valid_url(&identity.repository_root)?;
    if destination.path().trim_end_matches('/') == root.path().trim_end_matches('/') {
        return Err("Select a new child URL, not the repository root".into());
    }
    let mut parent = destination.clone();
    parent
        .path_segments_mut()
        .map_err(|_| "Invalid repository URL")?
        .pop_if_empty()
        .pop();
    let (_, uuid) = w::remote(path, parent.as_str()).await?;
    if uuid != identity.uuid {
        return Err("The destination is in another SVN repository".into());
    }
    destination
        .path_segments_mut()
        .map_err(|_| "Invalid repository URL")?
        .pop_if_empty();
    Ok(destination.into())
}

pub(crate) async fn run(path: &str, expected_url: &str, action: Action) -> w::Result<String> {
    let identity = w::identity(path).await?;
    let _writer = action
        .writer()
        .then(|| w::acquire_identity(&identity))
        .transpose()?;
    let workspace = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let at_root = workspace == fs::canonicalize(&identity.root).map_err(|e| e.to_string())?;
    let current_url = if at_root {
        identity.url.clone()
    } else {
        svn::info(path).await.map_err(|e| e.to_string())?.url
    };
    if current_url != expected_url {
        return Err("Working-copy source changed; reopen SVN tools".into());
    }

    if let Some(target) = action.target() {
        if target == "."
            && matches!(
                &action,
                Action::Add { .. }
                    | Action::Delete { .. }
                    | Action::Move { .. }
                    | Action::Copy { .. }
                    | Action::Mkdir { .. }
            )
        {
            return Err("Select a child path inside the working copy".into());
        }
        file_actions::owned(path, target).await?;
    }

    match action {
        Action::Info { target } => w::run(path, &["info", "--", &w::target(&target)]).await,
        Action::Properties { target } => {
            w::run(
                path,
                &[
                    "proplist",
                    "--verbose",
                    "--depth",
                    "empty",
                    "--",
                    &w::target(&target),
                ],
            )
            .await
        }
        Action::RemoteStatus { target } => {
            w::run(
                path,
                &[
                    "status",
                    "--show-updates",
                    "--verbose",
                    "--depth",
                    "empty",
                    "--",
                    &w::target(&target),
                ],
            )
            .await
        }
        Action::Add { target } => svn::add(path, &[target])
            .await
            .map_err(|error| error.to_string()),
        Action::Delete { target } => {
            w::run(path, &["delete", "--keep-local", "--", &w::target(&target)]).await
        }
        Action::Mkdir { target } => {
            let full = w::safe_child(&workspace, &target)?;
            existing_parent(&full)?;
            require_absent(&full)?;
            w::run(path, &["mkdir", "--", &target]).await
        }
        Action::Copy {
            ref target,
            ref destination,
        }
        | Action::Move {
            ref target,
            ref destination,
        } => {
            let full = w::safe_child(&workspace, destination)?;
            existing_parent(&full)?;
            require_absent(&full)?;
            file_actions::owned(path, destination).await?;
            let command = if matches!(action, Action::Copy { .. }) {
                "copy"
            } else {
                "move"
            };
            w::run(path, &[command, "--", &w::target(target), destination]).await
        }
        Action::Lock { target, message } => {
            w::run(path, &["lock", "-m", &message, "--", &w::target(&target)]).await
        }
        Action::Unlock { target } => w::run(path, &["unlock", "--", &w::target(&target)]).await,
        Action::SetProperty {
            target,
            name,
            value,
        } => {
            check_name(&name)?;
            w::run(path, &["propset", "--", &name, &value, &w::target(&target)]).await
        }
        Action::DeleteProperty { target, name } => {
            check_name(&name)?;
            w::run(path, &["propdel", "--", &name, &w::target(&target)]).await
        }
        Action::Changelist { target, name } => {
            if name.trim().is_empty() {
                return Err("Enter a changelist name".into());
            }
            w::run(
                path,
                &[
                    "changelist",
                    "--depth",
                    "empty",
                    "--",
                    &name,
                    &w::target(&target),
                ],
            )
            .await
        }
        Action::RemoveChangelist { target } => {
            w::run(
                path,
                &[
                    "changelist",
                    "--remove",
                    "--depth",
                    "empty",
                    "--",
                    &w::target(&target),
                ],
            )
            .await
        }
        Action::Cleanup => svn::cleanup(path).await.map_err(|error| error.to_string()),
        Action::Export {
            source,
            destination,
            revision,
        } => {
            let dest = Path::new(&destination);
            if !dest.is_absolute() {
                return Err("Choose an absolute export destination".into());
            }
            let parent = existing_parent(dest)?
                .canonicalize()
                .map_err(|e| e.to_string())?;
            let output = parent.join(dest.file_name().ok_or("Invalid destination name")?);
            require_absent(&output)?;
            if output.starts_with(fs::canonicalize(&identity.root).map_err(|e| e.to_string())?) {
                return Err("Choose an export destination outside the working copy".into());
            }
            if source.contains("://") {
                same_repository(&identity, &source)?;
            } else {
                file_actions::owned(path, &source).await?;
            }
            let target = match revision {
                Some(revision) if source.contains("://") => format!("{source}@{revision}"),
                _ => w::target(&source),
            };
            let mut args = vec!["export"];
            let rev = revision.map(|revision| revision.to_string());
            if let Some(rev) = &rev {
                args.extend(["-r", rev]);
            }
            let output = crate::strip_verbatim_prefix(&output.to_string_lossy());
            args.extend(["--", target.as_str(), output.as_str()]);
            w::run(path, &args).await
        }
        Action::Import {
            source,
            destination,
            message,
        } => {
            if !Path::new(&source).is_absolute() {
                return Err("Choose an absolute import source".into());
            }
            let source = fs::canonicalize(source).map_err(|e| e.to_string())?;
            if !source.is_file() && !source.is_dir() {
                return Err("Select a file or directory to import".into());
            }
            let destination = remote_destination(path, &identity, &destination, &message).await?;
            let source = crate::strip_verbatim_prefix(&source.to_string_lossy());
            // Import publishes the selected data as a repository revision.
            w::run(
                path,
                &["import", "-m", &message, "--", &source, &destination],
            )
            .await
        }
        Action::RemoteMkdir {
            destination,
            message,
        } => {
            let destination = remote_destination(path, &identity, &destination, &message).await?;
            w::run(
                path,
                &["mkdir", "-m", &message, "--", &w::target(&destination)],
            )
            .await
        }
        Action::Patch { source, reverse } => {
            if !Path::new(&source).is_absolute() {
                return Err("Choose an absolute patch path".into());
            }
            let patch = fs::read_to_string(source).map_err(|e| e.to_string())?;
            // SVN ignores headers outside the working root. Resolve every
            // recognized local path before allowing patch to touch it.
            let mut targets = BTreeSet::new();
            for line in patch.lines() {
                for prefix in ["Index: ", "--- ", "+++ ", "Property changes on: "] {
                    if let Some(target) = line.strip_prefix(prefix) {
                        let target = target.split('\t').next().unwrap_or("");
                        if target != "/dev/null" {
                            targets.insert(target);
                        }
                    }
                }
            }
            for target in targets {
                file_actions::owned(path, target).await?;
            }
            svn::apply_patch(path, &patch, reverse)
                .await
                .map_err(|error| error.to_string())
        }
        Action::Mergeinfo { source } => {
            same_repository(&identity, &source)?;
            w::run(
                path,
                &[
                    "mergeinfo",
                    "--show-revs",
                    "eligible",
                    "--",
                    &w::target(&source),
                    ".",
                ],
            )
            .await
        }
    }
}

#[tauri::command]
pub(crate) async fn svn_workspace_action(
    path: String,
    expected_url: String,
    action: Action,
) -> w::Result<String> {
    run(&path, &expected_url, action).await
}
