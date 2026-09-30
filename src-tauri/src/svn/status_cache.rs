use super::executor::SvnError;
use super::operations::{status, status_for_paths};
use crate::SvnStatus;
use notify::event::{CreateKind, ModifyKind, RemoveKind};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{BTreeSet, VecDeque};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const MAX_WORKSPACES: usize = 3;
const MAX_DIRTY_PATHS: usize = 256;
const FULL_CHECK_INTERVAL: Duration = Duration::from_secs(5 * 60);

type Workspace = Arc<tokio::sync::Mutex<WorkspaceStatus>>;
static WORKSPACES: OnceLock<Mutex<VecDeque<(PathBuf, Workspace)>>> = OnceLock::new();

#[derive(Default)]
struct Changes {
    paths: BTreeSet<String>,
    full_scan: bool,
    restart_watch: bool,
}

impl Changes {
    fn full(&mut self) {
        self.full_scan = true;
        self.paths.clear();
    }

    fn record(&mut self, root: &Path, result: notify::Result<Event>) {
        let event = match result {
            Ok(event) if !event.need_rescan() => event,
            _ => {
                self.restart_watch = true;
                self.full();
                return;
            }
        };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        if event.paths.is_empty() {
            self.restart_watch = true;
            self.full();
            return;
        }
        // Structural directory events may invalidate recursive watcher coverage
        // and cached descendant statuses. Establish a new complete baseline.
        if matches!(
            event.kind,
            EventKind::Create(CreateKind::Folder)
                | EventKind::Remove(RemoveKind::Folder)
                | EventKind::Other
                | EventKind::Any
        ) {
            self.restart_watch |= event.paths.iter().any(|path| path == root);
            self.full();
            return;
        }
        for path in event.paths {
            let relative = match path.strip_prefix(root) {
                Ok(relative) => relative,
                Err(_) => {
                    self.restart_watch = true;
                    self.full();
                    return;
                }
            };
            let components: Vec<_> = relative.components().collect();
            if let Some(index) = components
                .iter()
                .position(|part| part.as_os_str() == ".svn" || part.as_os_str() == "_svn")
            {
                // Temporary SVN files cannot change working-copy status.
                if components
                    .get(index + 1)
                    .is_some_and(|part| part.as_os_str() == "tmp")
                {
                    continue;
                }
                self.full();
                return;
            }
            if relative.as_os_str().is_empty() {
                self.restart_watch = true;
                self.full();
                return;
            }
            if components
                .iter()
                .any(|part| matches!(part, Component::ParentDir))
            {
                self.full();
                return;
            }
            if matches!(event.kind, EventKind::Modify(ModifyKind::Name(_))) && path.is_dir() {
                self.full();
                return;
            }
            let Some(relative) = relative.to_str() else {
                self.full();
                return;
            };
            self.paths.insert(relative.replace('\\', "/"));
            if self.paths.len() > MAX_DIRTY_PATHS {
                self.full();
                return;
            }
        }
    }
}

struct WorkspaceStatus {
    watcher: Option<RecommendedWatcher>,
    attempted_watch: bool,
    changes: Arc<Mutex<Changes>>,
    entries: Option<Vec<SvnStatus>>,
    last_full_check: Option<Instant>,
}

impl WorkspaceStatus {
    fn new() -> Self {
        Self {
            watcher: None,
            attempted_watch: false,
            changes: Arc::new(Mutex::new(Changes::default())),
            entries: None,
            last_full_check: None,
        }
    }
}

fn get_workspace(root: &Path) -> Result<Workspace, SvnError> {
    let mut workspaces = WORKSPACES
        .get_or_init(|| Mutex::new(VecDeque::new()))
        .lock()
        .map_err(|_| SvnError::CommandFailed("文件状态缓存锁已损坏".into()))?;
    if let Some(index) = workspaces.iter().position(|(path, _)| path == root) {
        let item = workspaces.remove(index).unwrap();
        let workspace = item.1.clone();
        workspaces.push_back(item);
        return Ok(workspace);
    }
    let workspace = Arc::new(tokio::sync::Mutex::new(WorkspaceStatus::new()));
    workspaces.push_back((root.to_path_buf(), workspace.clone()));
    while workspaces.len() > MAX_WORKSPACES {
        workspaces.pop_front();
    }
    Ok(workspace)
}

fn start_watching(root: PathBuf, changes: Arc<Mutex<Changes>>) -> Option<RecommendedWatcher> {
    let watch_root = root.clone();
    let mut watcher = match RecommendedWatcher::new(
        move |event| {
            if let Ok(mut changes) = changes.lock() {
                changes.record(&watch_root, event);
            }
        },
        Config::default().with_follow_symlinks(false),
    ) {
        Ok(watcher) => watcher,
        Err(error) => {
            tracing::warn!(%error, "filesystem watcher unavailable; using complete SVN scans");
            return None;
        }
    };
    if let Err(error) = watcher.watch(&root, RecursiveMode::Recursive) {
        tracing::warn!(%error, "filesystem watcher could not cover workspace; using complete SVN scans");
        return None;
    }
    Some(watcher)
}

fn merge_status(previous: &[SvnStatus], fresh: Vec<SvnStatus>, paths: &[String]) -> Vec<SvnStatus> {
    let collapsed: Vec<_> = fresh
        .iter()
        .filter(|entry| matches!(entry.status_code.as_str(), "missing" | "unversioned"))
        .map(|entry| entry.path.clone())
        .collect();
    let mut entries: Vec<_> = previous
        .iter()
        .filter(|entry| {
            !paths.iter().any(|path| entry.path == *path)
                && !collapsed.iter().any(|path| {
                    entry
                        .path
                        .strip_prefix(path)
                        .is_some_and(|tail| tail.starts_with('/'))
                })
        })
        .cloned()
        .collect();
    entries.extend(fresh);
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    entries.dedup_by(|a, b| a.path == b.path);
    entries
}

/// Filesystem notifications narrow subsequent status scans. No persisted cache
/// is trusted across process restarts, when filesystem events were not observed.
pub async fn cached_status(path: &str, force: bool) -> Result<Vec<SvnStatus>, SvnError> {
    let owned_path = path.to_string();
    let root = tokio::task::spawn_blocking(move || std::fs::canonicalize(owned_path))
        .await
        .map_err(|error| SvnError::CommandFailed(error.to_string()))?
        .map_err(|error| SvnError::CommandFailed(format!("无法访问工作副本：{error}")))?;
    let workspace = get_workspace(&root)?;
    let mut workspace = workspace.lock().await;
    if !workspace.attempted_watch {
        workspace.attempted_watch = true;
        let changes = workspace.changes.clone();
        let watch_root = root.clone();
        workspace.watcher =
            tokio::task::spawn_blocking(move || start_watching(watch_root, changes))
                .await
                .map_err(|error| SvnError::CommandFailed(error.to_string()))?;
    }
    if workspace.entries.is_some()
        && !force
        && workspace
            .changes
            .lock()
            .map(|changes| !changes.paths.is_empty())
            .unwrap_or(false)
    {
        // Let queued OS notifications arrive and coalesce an editor's atomic save.
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let changes = {
        let mut changes = workspace
            .changes
            .lock()
            .map_err(|_| SvnError::CommandFailed("文件变化队列锁已损坏".into()))?;
        std::mem::take(&mut *changes)
    };
    if changes.restart_watch {
        workspace.watcher.take();
        let events = workspace.changes.clone();
        let watch_root = root.clone();
        workspace.watcher = tokio::task::spawn_blocking(move || start_watching(watch_root, events))
            .await
            .map_err(|error| SvnError::CommandFailed(error.to_string()))?;
    }
    let full = force
        || workspace.entries.is_none()
        || workspace.watcher.is_none()
        || changes.full_scan
        || workspace
            .last_full_check
            .is_none_or(|time| time.elapsed() >= FULL_CHECK_INTERVAL);
    let paths: Vec<_> = changes.paths.into_iter().collect();
    let cwd = root.to_string_lossy();
    let mut used_full_scan = full;
    let result = if full {
        tracing::debug!(workspace = %cwd, "complete SVN status scan");
        status(&cwd).await
    } else if paths.is_empty() {
        tracing::debug!(workspace = %cwd, "filesystem unchanged; reusing SVN status");
        return Ok(workspace.entries.clone().unwrap_or_default());
    } else {
        tracing::debug!(workspace = %cwd, ?paths, "filesystem changes scoped SVN status");
        match status_for_paths(&cwd, &paths).await {
            Ok(fresh) => Ok(merge_status(
                workspace.entries.as_deref().unwrap_or_default(),
                fresh,
                &paths,
            )),
            // Missing/moved paths and external working copies can
            // make scoped queries fail. Retry once using the complete scanner.
            Err(error) => {
                tracing::debug!(%error, "scoped status failed; retrying complete scan");
                used_full_scan = true;
                status(&cwd).await
            }
        }
    };
    match result {
        Ok(entries) => {
            workspace.entries = Some(entries.clone());
            if used_full_scan {
                workspace.last_full_check = Some(Instant::now());
            }
            Ok(entries)
        }
        Err(error) => {
            if let Ok(mut changes) = workspace.changes.lock() {
                changes.full();
            }
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::fs;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn entry(path: &str, code: &str) -> SvnStatus {
        SvnStatus {
            path: path.into(),
            status: code.into(),
            status_code: code.into(),
            prop_status: "none".into(),
            locked: false,
            history: false,
            switched: false,
        }
    }

    #[test]
    fn file_events_choose_exact_paths_and_coalesce_atomic_saves() {
        let root = Path::new("/wc");
        let mut changes = Changes::default();
        for path in ["src/a.ts", "src/b.ts", "src/a.ts", "src2/c.ts", "new.txt"] {
            changes.record(
                root,
                Ok(Event::new(EventKind::Modify(ModifyKind::Data(
                    notify::event::DataChange::Content,
                )))
                .add_path(root.join(path))),
            );
        }
        assert!(!changes.full_scan);
        assert_eq!(
            changes.paths,
            ["new.txt", "src/a.ts", "src/b.ts", "src2/c.ts"]
                .map(String::from)
                .into_iter()
                .collect()
        );
    }

    #[test]
    fn svn_metadata_structural_events_and_monitor_failures_require_complete_verification() {
        for kind in [
            EventKind::Create(CreateKind::Folder),
            EventKind::Remove(RemoveKind::Folder),
            EventKind::Any,
        ] {
            let mut changes = Changes::default();
            changes.record(
                Path::new("/wc"),
                Ok(Event::new(kind).add_path(PathBuf::from("/wc/src"))),
            );
            assert!(changes.full_scan);
        }
        for path in [
            ".svn/wc.db",
            ".svn/wc.db-wal",
            "external/.svn/wc.db",
            ".svn/entries",
        ] {
            let mut changes = Changes::default();
            changes.record(
                Path::new("/wc"),
                Ok(Event::new(EventKind::Modify(ModifyKind::Any))
                    .add_path(Path::new("/wc").join(path))),
            );
            assert!(changes.full_scan, "{path}");
        }
        let mut changes = Changes::default();
        changes.record(Path::new("/wc"), Err(notify::Error::generic("overflow")));
        assert!(changes.full_scan);
        let mut changes = Changes::default();
        changes.record(
            Path::new("/wc"),
            Ok(Event::new(EventKind::Modify(ModifyKind::Any))
                .set_flag(notify::event::Flag::Rescan)),
        );
        assert!(changes.full_scan);
    }

    #[test]
    fn irrelevant_access_and_svn_temporary_events_do_not_schedule_scans() {
        let mut changes = Changes::default();
        changes.record(
            Path::new("/wc"),
            Ok(
                Event::new(EventKind::Access(notify::event::AccessKind::Read))
                    .add_path(PathBuf::from("/wc/src/a")),
            ),
        );
        changes.record(
            Path::new("/wc"),
            Ok(Event::new(EventKind::Modify(ModifyKind::Any))
                .add_path(PathBuf::from("/wc/.svn/tmp/temp"))),
        );
        assert!(!changes.full_scan);
        assert!(changes.paths.is_empty());
    }

    #[test]
    fn scoped_merge_removes_cleaned_files_without_erasing_other_paths() {
        let previous = [
            entry("src/a", "modified"),
            entry("src/sub/keep", "modified"),
            entry("src2/a", "modified"),
        ];
        let merged = merge_status(
            &previous,
            vec![entry("src/new", "unversioned")],
            &["src/a".into(), "src/new".into()],
        );
        assert_eq!(
            merged
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>(),
            ["src/new", "src/sub/keep", "src2/a"]
        );
        let merged = merge_status(
            &previous,
            vec![entry("src/sub", "missing")],
            &["src/a".into(), "src/sub".into()],
        );
        assert_eq!(
            merged
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>(),
            ["src/sub", "src2/a"]
        );
    }

    struct Fixture {
        root: PathBuf,
        wc: PathBuf,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    impl Fixture {
        fn new() -> Option<Self> {
            if Command::new("svnadmin").arg("--version").output().is_err() {
                eprintln!("Skipping real SVN fixture: svnadmin not available");
                return None;
            }
            let root = std::env::temp_dir().join(format!(
                "orcasvn-scopes-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&root).unwrap();
            let repository = root.join("repo");
            assert!(Command::new("svnadmin")
                .arg("create")
                .arg(&repository)
                .output()
                .unwrap()
                .status
                .success());
            let fixture = Self {
                wc: root.join("wc"),
                root,
            };
            let url = format!(
                "file:///{}",
                repository
                    .to_string_lossy()
                    .replace('\\', "/")
                    .trim_start_matches('/')
            );
            fixture.svn(&["checkout", &url, fixture.wc.to_str().unwrap()]);
            Some(fixture)
        }
        fn svn(&self, args: &[&str]) {
            let output = Command::new("svn").args(args).output().unwrap();
            assert!(
                output.status.success(),
                "{:?}: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            );
        }
        fn init(&self) {
            fs::create_dir_all(self.wc.join("src/sub")).unwrap();
            fs::write(self.wc.join("src/file@name.txt"), "base\n").unwrap();
            fs::write(self.wc.join("src/sub/other.txt"), "base\n").unwrap();
            self.svn(&["add", self.wc.join("src").to_str().unwrap()]);
            self.svn(&[
                "propset",
                "svn:ignore",
                "build\n*.tmp",
                self.wc.to_str().unwrap(),
            ]);
            self.svn(&["commit", self.wc.to_str().unwrap(), "-m", "initial"]);
        }
    }
    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }
    fn statuses(entries: &[SvnStatus]) -> BTreeMap<String, String> {
        entries
            .iter()
            .map(|entry| (entry.path.clone(), format!("{entry:?}")))
            .collect()
    }
    async fn wait_for_event(wc: &Path) {
        let cache = get_workspace(&wc.canonicalize().unwrap()).unwrap();
        for _ in 0..60 {
            {
                let workspace = cache.lock().await;
                if workspace.watcher.is_none() {
                    return;
                }
                let changes = workspace.changes.lock().unwrap();
                if changes.full_scan || !changes.paths.is_empty() {
                    return;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("filesystem modification did not reach status cache");
    }

    #[test]
    fn real_svn_scoped_status_preserves_ignore_rules_and_unversioned_directory_collapsing() {
        let Some(fixture) = Fixture::new() else {
            return;
        };
        fixture.init();
        fs::create_dir_all(fixture.wc.join("build/deep")).unwrap();
        fs::write(fixture.wc.join("build/deep/generated.txt"), "ignored").unwrap();
        fs::create_dir_all(fixture.wc.join("new-dir/deep")).unwrap();
        fs::write(fixture.wc.join("new-dir/deep/new.txt"), "new").unwrap();
        runtime().block_on(async {
            let full = status(fixture.wc.to_str().unwrap()).await.unwrap();
            let fresh = status_for_paths(
                fixture.wc.to_str().unwrap(),
                &[
                    "build/deep/generated.txt".into(),
                    "new-dir/deep/new.txt".into(),
                ],
            )
            .await
            .unwrap();
            assert_eq!(
                statuses(&merge_status(
                    &full,
                    fresh,
                    &[
                        "build/deep/generated.txt".into(),
                        "new-dir/deep/new.txt".into()
                    ]
                )),
                statuses(&full)
            );
        });
    }

    #[test]
    fn real_filesystem_changes_update_reverted_renamed_added_and_missing_files() {
        let Some(fixture) = Fixture::new() else {
            return;
        };
        fixture.init();
        runtime().block_on(async {
            let wc = fixture.wc.to_str().unwrap();
            assert!(cached_status(wc, false).await.unwrap().is_empty());
            fs::write(fixture.wc.join("src/file@name.txt"), "changed\n").unwrap();
            wait_for_event(&fixture.wc).await;
            assert_eq!(
                statuses(&cached_status(wc, false).await.unwrap()),
                statuses(&status(wc).await.unwrap())
            );
            fs::write(fixture.wc.join("src/file@name.txt"), "base\n").unwrap();
            fs::rename(
                fixture.wc.join("src/sub/other.txt"),
                fixture.wc.join("src/sub/renamed.txt"),
            )
            .unwrap();
            fs::write(fixture.wc.join("added.txt"), "new").unwrap();
            fs::write(fixture.wc.join("ignored.tmp"), "ignored").unwrap();
            wait_for_event(&fixture.wc).await;
            let actual = cached_status(wc, false).await.unwrap();
            assert_eq!(statuses(&actual), statuses(&status(wc).await.unwrap()));
            assert!(!actual
                .iter()
                .any(|entry| entry.path.ends_with("ignored.tmp")));
            // Another SVN client changed metadata: complete verification is required.
            fixture.svn(&[
                "delete",
                fixture.wc.join("src").to_str().unwrap(),
                "--force",
            ]);
            wait_for_event(&fixture.wc).await;
            let actual = cached_status(wc, false).await.unwrap();
            assert!(actual
                .iter()
                .any(|entry| entry.path == "src/sub/other.txt" && entry.status_code == "deleted"));
            assert_eq!(statuses(&actual), statuses(&status(wc).await.unwrap()));
        });
    }

    #[test]
    #[ignore = "creates a real 20,000-file working copy for performance measurement"]
    fn benchmark_twenty_thousand_files_forty_changes() {
        let Some(fixture) = Fixture::new() else {
            panic!("svnadmin required for benchmark");
        };
        for directory in 0..200 {
            let target = fixture.wc.join(format!("group-{directory:03}"));
            fs::create_dir_all(&target).unwrap();
            for file in 0..100 {
                fs::write(target.join(format!("file-{file:03}.txt")), "baseline\n").unwrap();
            }
        }
        fixture.svn(&["add", fixture.wc.to_str().unwrap(), "--force"]);
        fixture.svn(&["commit", fixture.wc.to_str().unwrap(), "-m", "baseline"]);
        runtime().block_on(async {
            let wc = fixture.wc.to_str().unwrap();
            let initial = Instant::now();
            cached_status(wc, false).await.unwrap();
            let initial_ms = initial.elapsed().as_secs_f64() * 1000.;
            for file in 0..40 { fs::write(fixture.wc.join(format!("group-000/file-{file:03}.txt")), "modified\n").unwrap(); }
            wait_for_event(&fixture.wc).await;
            let start = Instant::now();
            let scoped = cached_status(wc, false).await.unwrap();
            let scoped_ms = start.elapsed().as_secs_f64() * 1000.;
            let start = Instant::now();
            let full = status(wc).await.unwrap();
            let full_ms = start.elapsed().as_secs_f64() * 1000.;
            assert_eq!(scoped.len(), 40);
            assert_eq!(statuses(&scoped), statuses(&full));
            let start = Instant::now();
            cached_status(wc, false).await.unwrap();
            let unchanged_ms = start.elapsed().as_secs_f64() * 1000.;
            eprintln!("20,000 files / 40 changes: initial + watcher {initial_ms:.1} ms, filesystem-scoped {scoped_ms:.1} ms (includes 25 ms event coalescing), full SVN {full_ms:.1} ms, unchanged {unchanged_ms:.1} ms");
        });
    }
}
