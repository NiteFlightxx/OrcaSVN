use crate::{asset_stash as stash, workflows as w};
use std::{fs, path::PathBuf, process::Command};

struct Fixture {
    temp: PathBuf,
    url: String,
    dev: String,
    publish: String,
}
impl Fixture {
    fn new() -> Self {
        let parent = std::env::temp_dir();
        assert!(
            !parent
                .ancestors()
                .any(|ancestor| ancestor.join(".svn").exists() || ancestor.join(".git").exists()),
            "Tests must use isolated directories outside existing working copies"
        );
        fs::create_dir_all(&parent).unwrap();
        let parent = PathBuf::from(crate::strip_verbatim_prefix(
            &fs::canonicalize(parent).unwrap().to_string_lossy(),
        ));
        assert!(
            !parent
                .ancestors()
                .any(|ancestor| ancestor.join(".svn").exists() || ancestor.join(".git").exists()),
            "Tests must use isolated directories outside existing working copies"
        );
        let temp = parent.join(format!("orcasvn-workflow-{}", w::id()));
        fs::create_dir(&temp).unwrap();
        let repo = temp.join("repository");
        let output = Command::new("svnadmin")
            .arg("create")
            .arg(&repo)
            .output()
            .expect("svnadmin is required for workflow integration tests");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let url = url::Url::from_directory_path(&repo)
            .unwrap()
            .to_string()
            .trim_end_matches('/')
            .to_string();
        let fixture = Self {
            dev: temp.join("dev").to_string_lossy().into_owned(),
            publish: temp.join("publish").to_string_lossy().into_owned(),
            temp,
            url,
        };
        fixture.svn(
            None,
            &["mkdir", &format!("{}/dev", fixture.url), "-m", "dev"],
        );
        fixture.svn(
            None,
            &["checkout", &format!("{}/dev", fixture.url), &fixture.dev],
        );
        fs::write(PathBuf::from(&fixture.dev).join("text.txt"), "base\n").unwrap();
        fs::write(
            PathBuf::from(&fixture.dev).join("asset.uasset"),
            [0, 1, 255, 7],
        )
        .unwrap();
        fs::write(
            PathBuf::from(&fixture.dev).join("delete.txt"),
            "delete me\n",
        )
        .unwrap();
        fixture.svn(
            Some(&fixture.dev),
            &["add", "text.txt", "asset.uasset", "delete.txt"],
        );
        fixture.svn(Some(&fixture.dev), &["commit", "-m", "initial"]);
        fixture.svn(
            None,
            &[
                "copy",
                &format!("{}/dev", fixture.url),
                &format!("{}/publish", fixture.url),
                "-m",
                "publish",
            ],
        );
        fixture.svn(
            None,
            &[
                "checkout",
                &format!("{}/publish", fixture.url),
                &fixture.publish,
            ],
        );
        fixture.svn(Some(&fixture.dev), &["update"]);
        fixture
    }
    fn svn(&self, cwd: Option<&str>, args: &[&str]) -> String {
        let mut command = Command::new("svn");
        command.arg("--non-interactive").args(args);
        if let Some(path) = cwd {
            command.current_dir(path);
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{args:?}\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).into_owned()
    }
    fn root(&self) -> PathBuf {
        PathBuf::from(&self.dev)
    }
    fn seed_directory(&self) {
        fs::create_dir(self.root().join("folder")).unwrap();
        fs::write(self.root().join("folder/a.txt"), "original-a").unwrap();
        fs::write(self.root().join("folder/b.uasset"), [0, 8, 255]).unwrap();
        fs::write(self.root().join("folder/hidden.txt"), "original-hidden").unwrap();
        self.svn(Some(&self.dev), &["add", "--", "folder"]);
        self.svn(Some(&self.dev), &["commit", "-m", "synthetic directory"]);
        self.svn(Some(&self.dev), &["update"]);
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if self.temp.parent().and_then(|p| fs::canonicalize(p).ok())
            == fs::canonicalize(std::env::temp_dir()).ok()
            && self
                .temp
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("orcasvn-workflow-")
        {
            let _ = fs::remove_dir_all(&self.temp);
        }
    }
}
fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

#[test]
fn browse_switch_and_cherry_pick_real_repository() {
    let f = Fixture::new();
    let rt = runtime();
    rt.block_on(async {
        let entries = w::repository_list(f.publish.clone(), f.url.clone())
            .await
            .unwrap();
        assert_eq!(entries.len(), 2);
        let branch = w::repository_branch(f.publish.clone(), format!("{}/dev", f.url))
            .await
            .unwrap();
        assert_eq!(branch.url, format!("{}/dev", f.url));
        assert_eq!(branch.kind, "dir");
        fs::write(f.root().join("text.txt"), "picked\n").unwrap();
        f.svn(Some(&f.dev), &["commit", "-m", "pick this"]);
        let history = crate::svn::log(
            &format!("{}/dev", f.url),
            Some(10),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(history[0].revision, 4);
        assert!(history[0].message.contains("pick this"));
        f.svn(Some(&f.publish), &["update"]);
        let preview = w::repository_preview(f.publish.clone(), format!("{}/dev", f.url), Some(4))
            .await
            .unwrap();
        assert_eq!(
            fs::read_to_string(PathBuf::from(&f.publish).join("text.txt")).unwrap(),
            "base\n"
        );
        let result = w::execute_plan(&f.temp.join("data"), &preview.id)
            .await
            .unwrap();
        assert!(result.error.is_none(), "{result:?}");
        assert!(result.conflicts.is_empty());
        assert_eq!(
            fs::read_to_string(PathBuf::from(&f.publish).join("text.txt")).unwrap(),
            "picked\n"
        );
        assert!(f.svn(Some(&f.publish), &["status"]).contains("text.txt"));
        f.svn(Some(&f.publish), &["commit", "-m", "merge r4"]);
        f.svn(Some(&f.publish), &["update"]);
        assert!(
            w::repository_preview(f.publish.clone(), format!("{}/dev", f.url), Some(4))
                .await
                .is_err()
        );
        let plan = w::repository_preview(f.publish.clone(), format!("{}/dev", f.url), None)
            .await
            .unwrap();
        let result = w::execute_plan(&f.temp.join("data"), &plan.id)
            .await
            .unwrap();
        assert!(result.error.is_none(), "{result:?}");
        assert!(result.identity.unwrap().url.ends_with("/dev"));
    });
}
#[test]
fn dirty_and_changed_previews_are_rejected_and_writers_exclude_each_other() {
    let f = Fixture::new();
    runtime().block_on(async {
        let plan = w::repository_preview(f.publish.clone(), format!("{}/dev", f.url), None)
            .await
            .unwrap();
        fs::write(PathBuf::from(&f.publish).join("text.txt"), "unsaved\n").unwrap();
        assert!(w::execute_plan(&f.temp.join("data"), &plan.id)
            .await
            .is_err());
        let _writer = w::acquire(&f.dev).await.unwrap();
        assert!(w::acquire(&f.dev).await.is_err());
        assert_eq!(
            fs::read_to_string(PathBuf::from(&f.publish).join("text.txt")).unwrap(),
            "unsaved\n"
        );
    });
}

#[test]
fn switch_preserves_local_content_properties_schedules_and_untracked_directories() {
    let f = Fixture::new();
    runtime().block_on(async {
        let root = f.root();
        fs::write(root.join("asset.uasset"), [0, 42, 255, 3]).unwrap();
        f.svn(
            Some(&f.dev),
            &["propset", "custom", "local-value", "asset.uasset"],
        );
        fs::write(root.join("added.txt"), "local addition").unwrap();
        f.svn(Some(&f.dev), &["add", "added.txt"]);
        f.svn(Some(&f.dev), &["delete", "delete.txt"]);
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(
            root.join(".git/synthetic-marker"),
            "leave nested repository alone",
        )
        .unwrap();
        fs::create_dir_all(root.join("untracked/sub")).unwrap();
        fs::write(root.join("untracked/sub/keep.bin"), [0, 7, 255]).unwrap();
        fs::write(
            PathBuf::from(&f.publish).join("text.txt"),
            "target branch\n",
        )
        .unwrap();
        f.svn(Some(&f.publish), &["commit", "-m", "target change"]);
        let plan = w::repository_preview(f.dev.clone(), format!("{}/publish", f.url), None)
            .await
            .unwrap();
        assert!(plan.local_changes.contains(&"asset.uasset".into()));
        assert!(plan.local_changes.contains(&"added.txt".into()));
        let result = w::execute_plan(&f.temp.join("data"), &plan.id)
            .await
            .unwrap();
        assert!(result.error.is_none(), "{result:?}");
        assert!(result.conflicts.is_empty());
        assert_eq!(
            fs::read(root.join("asset.uasset")).unwrap(),
            [0, 42, 255, 3]
        );
        assert!(f
            .svn(Some(&f.dev), &["propget", "custom", "asset.uasset"])
            .contains("local-value"));
        assert_eq!(
            fs::read_to_string(root.join("text.txt")).unwrap(),
            "target branch\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("added.txt")).unwrap(),
            "local addition"
        );
        assert!(!root.join("delete.txt").exists());
        assert_eq!(
            fs::read(root.join("untracked/sub/keep.bin")).unwrap(),
            [0, 7, 255]
        );
        assert_eq!(
            fs::read_to_string(root.join(".git/synthetic-marker")).unwrap(),
            "leave nested repository alone"
        );
        let status = w::local_status(&f.dev, false).await.unwrap();
        assert!(status
            .iter()
            .any(|s| s.path == "added.txt" && s.status_code == "added"));
        assert!(status
            .iter()
            .any(|s| s.path == "delete.txt" && s.status_code == "deleted"));
        assert!(!f.temp.join("data/recovery").exists());
        let journal: serde_json::Value = serde_json::from_slice(
            &fs::read(f.temp.join(format!("data/operations/{}.json", plan.id))).unwrap(),
        )
        .unwrap();
        assert!(journal["after"].is_null());
    });
}

#[test]
fn switch_merges_non_overlapping_edits_in_the_same_file() {
    let f = Fixture::new();
    runtime().block_on(async {
        let base = (0..12).map(|i| format!("line {i}\n")).collect::<String>();
        fs::write(f.root().join("shared.txt"), &base).unwrap();
        f.svn(Some(&f.dev), &["add", "shared.txt"]);
        f.svn(Some(&f.dev), &["commit", "-m", "shared base"]);
        let target_url = format!("{}/switch-target", f.url);
        f.svn(
            None,
            &[
                "copy",
                &format!("{}/dev", f.url),
                &target_url,
                "-m",
                "related branch",
            ],
        );
        let target = f.temp.join("target").to_string_lossy().into_owned();
        f.svn(None, &["checkout", &target_url, &target]);
        fs::write(
            PathBuf::from(&target).join("shared.txt"),
            base.replace("line 11\n", "incoming last line\n"),
        )
        .unwrap();
        f.svn(Some(&target), &["commit", "-m", "incoming end edit"]);
        fs::write(
            f.root().join("shared.txt"),
            base.replace("line 0\n", "local first line\n"),
        )
        .unwrap();
        let plan = w::repository_preview(f.dev.clone(), target_url, None)
            .await
            .unwrap();
        let result = w::execute_plan(&f.temp.join("data"), &plan.id)
            .await
            .unwrap();
        assert!(result.error.is_none(), "{result:?}");
        assert!(result.conflicts.is_empty());
        let merged = fs::read_to_string(f.root().join("shared.txt")).unwrap();
        assert!(merged.starts_with("local first line\n"));
        assert!(merged.ends_with("incoming last line\n"));
    });
}

#[test]
fn switch_defers_text_and_binary_conflicts_without_selecting_a_winner() {
    let f = Fixture::new();
    runtime().block_on(async {
        fs::write(f.root().join("text.txt"), "local text\n").unwrap();
        fs::write(f.root().join("asset.uasset"), [0, 42, 255, 3]).unwrap();
        fs::write(
            PathBuf::from(&f.publish).join("text.txt"),
            "incoming text\n",
        )
        .unwrap();
        fs::write(
            PathBuf::from(&f.publish).join("asset.uasset"),
            [0, 64, 254, 6],
        )
        .unwrap();
        f.svn(
            Some(&f.publish),
            &["commit", "-m", "conflicting target changes"],
        );
        let plan = w::repository_preview(f.dev.clone(), format!("{}/publish", f.url), None)
            .await
            .unwrap();
        let result = w::execute_plan(&f.temp.join("data"), &plan.id)
            .await
            .unwrap();
        assert!(result.conflicts.contains(&"text.txt".into()), "{result:?}");
        assert!(
            result.conflicts.contains(&"asset.uasset".into()),
            "{result:?}"
        );
        assert_eq!(
            fs::read(f.root().join("asset.uasset")).unwrap(),
            [0, 42, 255, 3]
        );
        let text = fs::read_to_string(f.root().join("text.txt")).unwrap();
        assert!(text.contains("local text"));
        assert!(text.contains("incoming text"));
        let conflicts = w::repository_conflicts(f.dev.clone()).await.unwrap();
        assert_eq!(conflicts.len(), 2);
        assert!(conflicts.iter().all(|c| !c.versions.is_empty()));
        assert!(!f.temp.join("data/recovery").exists());
    });
}

#[test]
fn switch_rejects_changes_to_already_modified_bytes_or_properties_after_preview() {
    let f = Fixture::new();
    runtime().block_on(async {
        fs::write(f.root().join("text.txt"), "local1\n").unwrap();
        let plan = w::repository_preview(f.dev.clone(), format!("{}/publish", f.url), None)
            .await
            .unwrap();
        fs::write(f.root().join("text.txt"), "local2\n").unwrap();
        assert!(w::execute_plan(&f.temp.join("data"), &plan.id)
            .await
            .is_err());
        assert_eq!(
            w::identity(&f.dev).await.unwrap().url,
            format!("{}/dev", f.url)
        );
        f.svn(Some(&f.dev), &["propset", "custom", "first", "text.txt"]);
        let plan = w::repository_preview(f.dev.clone(), format!("{}/publish", f.url), None)
            .await
            .unwrap();
        f.svn(Some(&f.dev), &["propset", "custom", "later", "text.txt"]);
        assert!(w::execute_plan(&f.temp.join("data"), &plan.id)
            .await
            .is_err());
        assert_eq!(
            fs::read_to_string(f.root().join("text.txt")).unwrap(),
            "local2\n"
        );
    });
}

#[test]
fn switch_reports_untracked_obstructions_without_overwriting_the_local_file() {
    let f = Fixture::new();
    runtime().block_on(async {
        fs::write(f.root().join("new.txt"), "local unversioned").unwrap();
        fs::write(
            PathBuf::from(&f.publish).join("new.txt"),
            "incoming versioned",
        )
        .unwrap();
        f.svn(Some(&f.publish), &["add", "new.txt"]);
        f.svn(Some(&f.publish), &["commit", "-m", "add colliding target"]);
        let plan = w::repository_preview(f.dev.clone(), format!("{}/publish", f.url), None)
            .await
            .unwrap();
        let result = w::execute_plan(&f.temp.join("data"), &plan.id)
            .await
            .unwrap();
        assert!(
            result.error.is_some() || !result.conflicts.is_empty(),
            "{result:?}"
        );
        assert_eq!(
            fs::read_to_string(f.root().join("new.txt")).unwrap(),
            "local unversioned"
        );
    });
}

#[test]
fn switch_policy_does_not_relax_the_clean_tree_requirement_for_cherry_pick() {
    let f = Fixture::new();
    runtime().block_on(async {
        fs::write(f.root().join("text.txt"), "local\n").unwrap();
        let error = w::repository_preview(f.dev.clone(), format!("{}/publish", f.url), Some(2))
            .await
            .unwrap_err();
        assert!(error.contains("Commit, stash or resolve"));
        assert_eq!(
            fs::read_to_string(f.root().join("text.txt")).unwrap(),
            "local\n"
        );
    });
}
#[test]
fn binary_stash_round_trip_preserves_large_files_properties_and_schedules() {
    let f = Fixture::new();
    let root = f.root();
    let data = f.temp.join("data");
    let binary = vec![137u8; 3 * 1024 * 1024 + 17];
    fs::write(root.join("asset.uasset"), &binary).unwrap();
    fs::write(root.join("新资产@.umap"), &binary).unwrap();
    fs::write(root.join("added.txt"), "new\r\n").unwrap();
    fs::create_dir(root.join("empty")).unwrap();
    f.svn(Some(&f.dev), &["add", "added.txt"]);
    f.svn(Some(&f.dev), &["delete", "delete.txt"]);
    fs::write(f.temp.join("property-value"), "中文值".as_bytes()).unwrap();
    f.svn(
        Some(&f.dev),
        &[
            "propset",
            "custom",
            "--file",
            &f.temp.join("property-value").to_string_lossy(),
            "asset.uasset",
        ],
    );
    runtime().block_on(async {
        let info = w::identity(&f.dev).await.unwrap();
        let files: Vec<_> = [
            "asset.uasset",
            "新资产@.umap",
            "added.txt",
            "delete.txt",
            "empty",
        ]
        .into_iter()
        .map(str::to_string)
        .collect();
        let record = stash::create(&data, &f.dev, "UE WIP", &files, &info.url)
            .await
            .unwrap();
        assert_eq!(record.phase, "complete", "{record:?}");
        assert_eq!(fs::read(root.join("asset.uasset")).unwrap(), [0, 1, 255, 7]);
        assert!(!root.join("新资产@.umap").exists());
        assert!(root.join("delete.txt").exists());
        let result = stash::apply(&data, &f.dev, &record.id, true, &[])
            .await
            .unwrap();
        assert_eq!(result.phase, "popped", "{result:?}");
        assert_eq!(fs::read(root.join("asset.uasset")).unwrap(), binary);
        assert_eq!(fs::read(root.join("新资产@.umap")).unwrap(), binary);
        assert!(!root.join("delete.txt").exists());
        assert!(root.join("empty").is_dir());
        let status = f.svn(Some(&f.dev), &["status"]);
        assert!(status
            .lines()
            .any(|l| l.starts_with('A') && l.contains("added.txt")));
        assert!(status
            .lines()
            .any(|l| l.starts_with('D') && l.contains("delete.txt")));
        let prop = f.svn(
            Some(&f.dev),
            &["propget", "--xml", "custom", "asset.uasset"],
        );
        assert!(prop.contains("中文值"), "{prop}\n{record:?}");
    });
}
#[test]
fn stash_refuses_changed_targets_wrong_branch_and_traversal() {
    let f = Fixture::new();
    let data = f.temp.join("data");
    fs::write(f.root().join("asset.uasset"), [0, 10, 20]).unwrap();
    runtime().block_on(async {
        let info = w::identity(&f.dev).await.unwrap();
        let record = stash::create(&data, &f.dev, "work", &["asset.uasset".into()], &info.url)
            .await
            .unwrap();
        fs::write(f.root().join("asset.uasset"), [0, 99]).unwrap();
        assert!(stash::apply(&data, &f.dev, &record.id, true, &[])
            .await
            .is_err());
        assert_eq!(fs::read(f.root().join("asset.uasset")).unwrap(), [0, 99]);
        assert!(stash::apply(&data, &f.publish, &record.id, true, &[])
            .await
            .is_err());
        assert!(w::safe_child(&f.root(), "../outside").is_err());
        assert!(w::safe_child(&f.root(), ".SVN/wc.db").is_err());
        assert_eq!(stash::read(&data, &record.id).unwrap().phase, "complete");
    });
}

#[test]
fn cherry_pick_conflict_is_detected_and_resolved_with_a_backup() {
    let f = Fixture::new();
    runtime().block_on(async {
        fs::write(f.root().join("text.txt"), "dev version\n").unwrap();
        f.svn(Some(&f.dev), &["commit", "-m", "dev"]);
        fs::write(
            PathBuf::from(&f.publish).join("text.txt"),
            "publish version\n",
        )
        .unwrap();
        f.svn(Some(&f.publish), &["commit", "-m", "publish"]);
        f.svn(Some(&f.publish), &["update"]);
        let preview = w::repository_preview(f.publish.clone(), format!("{}/dev", f.url), Some(4))
            .await
            .unwrap();
        let result = w::execute_plan(&f.temp.join("data"), &preview.id)
            .await
            .unwrap();
        assert!(result.error.is_none());
        assert_eq!(result.conflicts, ["text.txt"]);
        let conflicts = w::repository_conflicts(f.publish.clone()).await.unwrap();
        assert_eq!(conflicts[0].kind, "content");
        assert!(!conflicts[0].versions.is_empty(), "{conflicts:?}");
        let result = w::resolve(
            &f.temp.join("data"),
            &f.publish,
            "text.txt",
            "mine-full",
            &format!("{}/publish", f.url),
        )
        .await
        .unwrap();
        assert!(result.error.is_none(), "{result:?}");
        assert!(result.conflicts.is_empty());
        assert_eq!(
            fs::read_to_string(PathBuf::from(&f.publish).join("text.txt")).unwrap(),
            "publish version\n"
        );
        assert!(f.temp.join("data/recovery").is_dir());
    });
}
#[test]
fn undo_refuses_unrelated_edits_and_reverts_only_an_unchanged_application() {
    let f = Fixture::new();
    let data = f.temp.join("data");
    runtime().block_on(async {
        fs::write(f.root().join("text.txt"), "picked\n").unwrap();
        fs::write(f.root().join("new.txt"), "new\n").unwrap();
        f.svn(Some(&f.dev), &["add", "new.txt"]);
        f.svn(Some(&f.dev), &["commit", "-m", "dev"]);
        f.svn(Some(&f.publish), &["update"]);
        let preview = w::repository_preview(f.publish.clone(), format!("{}/dev", f.url), Some(4))
            .await
            .unwrap();
        w::execute_plan(&data, &preview.id).await.unwrap();
        let asset = PathBuf::from(&f.publish).join("asset.uasset");
        fs::write(&asset, [0, 9]).unwrap();
        assert!(w::undo(&data, &preview.id).await.is_err());
        assert_eq!(fs::read(&asset).unwrap(), [0, 9]);
        f.svn(Some(&f.publish), &["revert", "asset.uasset"]);
        let result = w::undo(&data, &preview.id).await.unwrap();
        assert!(result.error.is_none(), "{result:?}");
        assert_eq!(
            fs::read_to_string(PathBuf::from(&f.publish).join("text.txt")).unwrap(),
            "base\n"
        );
        assert!(!PathBuf::from(&f.publish).join("new.txt").exists());
        assert!(f.svn(Some(&f.publish), &["status"]).trim().is_empty());
    });
}
#[test]
fn legacy_migration_is_idempotent_and_preserves_original_data() {
    let f = Fixture::new();
    let data = f.temp.join("data");
    let original = serde_json::json!({"id":"old-id","name":"old","workspacePath":f.dev,"createdAt":"2026-01-01T00:00:00Z","patch":"Index: text.txt\n","files":["text.txt"],"hunkCount":1});
    assert_eq!(
        stash::migrate_legacy(&data, vec![original.clone()]).unwrap(),
        ["old-id"]
    );
    assert_eq!(
        stash::migrate_legacy(&data, vec![original.clone()]).unwrap(),
        ["old-id"]
    );
    let record = stash::read(&data, &format!("legacy-{}", w::digest(b"old-id"))).unwrap();
    assert_eq!(record.legacy, Some(original));
    assert!(record.identity.uuid.is_empty());
}

#[test]
fn directory_stash_restores_added_deleted_and_unversioned_subtrees() {
    let f = Fixture::new();
    let root = f.root();
    fs::create_dir_all(root.join("old/sub")).unwrap();
    fs::write(root.join("old/sub/asset.umap"), [0, 7, 9]).unwrap();
    f.svn(Some(&f.dev), &["add", "old"]);
    f.svn(Some(&f.dev), &["commit", "-m", "tree"]);
    f.svn(Some(&f.dev), &["update"]);
    f.svn(Some(&f.dev), &["delete", "old"]);
    for name in ["added", "untracked"] {
        fs::create_dir_all(root.join(format!("{name}/empty"))).unwrap();
        fs::write(root.join(format!("{name}/asset.umap")), [0, 8, 3]).unwrap();
    }
    f.svn(Some(&f.dev), &["add", "added"]);
    runtime().block_on(async {
        let info = w::identity(&f.dev).await.unwrap();
        let record = stash::create(
            &f.temp.join("data"),
            &f.dev,
            "trees",
            &["old".into(), "added".into(), "untracked".into()],
            &info.url,
        )
        .await
        .unwrap();
        assert_eq!(record.phase, "complete", "{record:?}");
        assert!(root.join("old/sub/asset.umap").exists());
        assert!(!root.join("added").exists());
        let result = stash::apply(&f.temp.join("data"), &f.dev, &record.id, true, &[])
            .await
            .unwrap();
        assert_eq!(result.phase, "popped", "{result:?}");
        assert!(!root.join("old").exists());
        for name in ["added", "untracked"] {
            assert_eq!(
                fs::read(root.join(format!("{name}/asset.umap"))).unwrap(),
                [0, 8, 3]
            );
            assert!(root.join(format!("{name}/empty")).is_dir());
        }
    });
}

#[test]
fn corrupt_payload_does_not_overwrite_or_consume_a_stash() {
    let f = Fixture::new();
    let data = f.temp.join("data");
    fs::write(f.root().join("asset.uasset"), [0, 9, 19]).unwrap();
    runtime().block_on(async {
        let info = w::identity(&f.dev).await.unwrap();
        let record = stash::create(&data, &f.dev, "asset", &["asset.uasset".into()], &info.url)
            .await
            .unwrap();
        let payload = data
            .join("stashes/v2")
            .join(&record.id)
            .join("payload")
            .join(record.nodes[0].working.as_ref().unwrap());
        fs::write(payload, "corrupt").unwrap();
        assert!(stash::apply(&data, &f.dev, &record.id, true, &[])
            .await
            .is_err());
        assert_eq!(
            fs::read(f.root().join("asset.uasset")).unwrap(),
            [0, 1, 255, 7]
        );
        assert_eq!(stash::read(&data, &record.id).unwrap().phase, "complete");
    });
}

#[test]
fn externals_are_excluded_and_nested_working_copies_are_rejected() {
    let f = Fixture::new();
    f.svn(
        Some(&f.dev),
        &["propset", "svn:externals", "^/publish external", "."],
    );
    f.svn(Some(&f.dev), &["update"]);
    fs::write(f.root().join("external/text.txt"), "external edit\n").unwrap();
    runtime().block_on(async {
        assert!(w::ensure_owned(&f.dev, "external/text.txt").await.is_err());
        assert!(w::ensure_owned(&f.dev, "external/absent/asset.uasset")
            .await
            .is_err());
        assert!(
            stash::asset_stash_candidates(f.dev.clone(), vec!["external/text.txt".into()])
                .await
                .is_err()
        );
        assert!(!w::local_status(&f.dev, false)
            .await
            .unwrap()
            .iter()
            .any(|s| s.path == "external/text.txt"));
        assert_eq!(
            fs::read_to_string(f.root().join("external/text.txt")).unwrap(),
            "external edit\n"
        );
    });
}

#[cfg(windows)]
#[test]
fn locked_assets_retain_working_data_and_recovery_records() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    let data = f.temp.join("data");
    let asset = f.root().join("asset.uasset");
    fs::write(&asset, [0, 31, 41]).unwrap();
    runtime().block_on(async {
        let info = w::identity(&f.dev).await.unwrap();
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&asset)
            .unwrap();
        assert!(
            stash::create(&data, &f.dev, "locked", &["asset.uasset".into()], &info.url)
                .await
                .is_err()
        );
        drop(lock);
        assert_eq!(fs::read(&asset).unwrap(), [0, 31, 41]);
        let record = stash::create(
            &data,
            &f.dev,
            "unlocked",
            &["asset.uasset".into()],
            &info.url,
        )
        .await
        .unwrap();
        assert_eq!(record.phase, "complete");
        // Read sharing permits recovery capture, but denies replacement of the open file.
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&asset)
            .unwrap();
        let result = stash::apply(&data, &f.dev, &record.id, true, &[])
            .await
            .unwrap();
        assert_eq!(result.phase, "partial", "{result:?}");
        drop(lock);
        assert_eq!(fs::read(&asset).unwrap(), [0, 1, 255, 7]);
        assert!(data
            .join("stashes/v2")
            .join(&record.id)
            .join("recovery")
            .is_dir());
        assert_eq!(stash::read(&data, &record.id).unwrap().phase, "partial");
    });
}

#[test]
fn migrated_legacy_patch_and_unversioned_file_can_be_restored() {
    use base64::Engine;
    let f = Fixture::new();
    let data = f.temp.join("data");
    fs::write(f.root().join("text.txt"), "legacy work\n").unwrap();
    let patch = f.svn(Some(&f.dev), &["diff", "text.txt"]);
    f.svn(Some(&f.dev), &["revert", "text.txt"]);
    let original = serde_json::json!({"id":"restore-old","workspacePath":f.dev,"patch":patch,"unversionedFiles":[{"path":"legacy.txt","kind":"file","contentBase64":base64::engine::general_purpose::STANDARD.encode(b"legacy new\n")}]});
    stash::migrate_legacy(&data, vec![original]).unwrap();
    runtime().block_on(async {
        let result = stash::apply(
            &data,
            &f.dev,
            &format!("legacy-{}", w::digest(b"restore-old")),
            true,
            &[],
        )
        .await
        .unwrap();
        assert_eq!(result.phase, "popped", "{result:?}");
        assert_eq!(
            fs::read_to_string(f.root().join("text.txt")).unwrap(),
            "legacy work\n"
        );
        assert_eq!(
            fs::read_to_string(f.root().join("legacy.txt")).unwrap(),
            "legacy new\n"
        );
    });
}

#[test]
fn switched_subtrees_are_reported_as_an_incomplete_result() {
    let f = Fixture::new();
    fs::create_dir(f.root().join("sub")).unwrap();
    f.svn(Some(&f.dev), &["add", "sub"]);
    f.svn(Some(&f.dev), &["commit", "-m", "add subtree"]);
    f.svn(
        Some(&f.dev),
        &[
            "switch",
            "--ignore-ancestry",
            &format!("{}/publish", f.url),
            "sub",
        ],
    );
    runtime().block_on(async {
        let result = w::outcome(&f.dev, "switch", Ok(String::new())).await;
        assert!(
            result.error.as_ref().is_some_and(|e| e.contains("sub")),
            "{result:?}"
        );
    });
}

#[test]
fn property_conflicts_require_manual_resolution_and_are_reported() {
    let f = Fixture::new();
    f.svn(Some(&f.dev), &["propset", "custom", "dev", "text.txt"]);
    f.svn(Some(&f.dev), &["commit", "-m", "dev property"]);
    f.svn(
        Some(&f.publish),
        &["propset", "custom", "publish", "text.txt"],
    );
    f.svn(Some(&f.publish), &["commit", "-m", "publish property"]);
    f.svn(Some(&f.publish), &["update"]);
    runtime().block_on(async {
        let plan = w::repository_preview(f.publish.clone(), format!("{}/dev", f.url), Some(4))
            .await
            .unwrap();
        let result = w::execute_plan(&f.temp.join("data"), &plan.id)
            .await
            .unwrap();
        assert_eq!(result.conflicts, ["text.txt"]);
        let conflicts = w::repository_conflicts(f.publish.clone()).await.unwrap();
        assert_eq!(conflicts[0].kind, "property");
        assert!(w::resolve(
            &f.temp.join("data"),
            &f.publish,
            "text.txt",
            "mine-full",
            &format!("{}/publish", f.url)
        )
        .await
        .is_err());
        let result = w::resolve(
            &f.temp.join("data"),
            &f.publish,
            "text.txt",
            "working",
            &format!("{}/publish", f.url),
        )
        .await
        .unwrap();
        assert!(result.error.is_none(), "{result:?}");
        assert!(result.conflicts.is_empty());
        assert!(f
            .svn(Some(&f.publish), &["propget", "custom", "text.txt"])
            .contains("publish"));
    });
}

#[test]
fn subdirectory_stash_does_not_capture_a_same_named_file_at_the_root() {
    let f = Fixture::new();
    let sub = f.root().join("sub");
    fs::create_dir(&sub).unwrap();
    fs::write(sub.join("text.txt"), "sub base\n").unwrap();
    f.svn(Some(&f.dev), &["add", "sub"]);
    f.svn(Some(&f.dev), &["commit", "-m", "add subdirectory file"]);
    fs::write(f.root().join("text.txt"), "unrelated root edit\n").unwrap();
    fs::write(sub.join("text.txt"), "sub edit\n").unwrap();
    runtime().block_on(async {
        let info = w::identity(&f.dev).await.unwrap();
        let record = stash::create(
            &f.temp.join("data"),
            &sub.to_string_lossy(),
            "sub",
            &["text.txt".into()],
            &info.url,
        )
        .await
        .unwrap();
        assert_eq!(record.phase, "complete", "{record:?}");
        assert_eq!(record.nodes[0].path, "sub/text.txt");
        assert_eq!(
            fs::read_to_string(f.root().join("text.txt")).unwrap(),
            "unrelated root edit\n"
        );
        assert_eq!(
            fs::read_to_string(sub.join("text.txt")).unwrap(),
            "sub base\n"
        );
        let result = stash::apply(
            &f.temp.join("data"),
            &sub.to_string_lossy(),
            &record.id,
            false,
            &[],
        )
        .await
        .unwrap();
        assert_eq!(result.phase, "complete", "{result:?}");
        assert_eq!(
            fs::read_to_string(sub.join("text.txt")).unwrap(),
            "sub edit\n"
        );
    });
}

#[test]
fn binary_conflict_resolution_preserves_both_versions_before_selecting_incoming() {
    let f = Fixture::new();
    fs::write(f.root().join("asset.uasset"), [0, 14, 24]).unwrap();
    f.svn(Some(&f.dev), &["commit", "-m", "dev asset"]);
    fs::write(PathBuf::from(&f.publish).join("asset.uasset"), [0, 34, 44]).unwrap();
    f.svn(Some(&f.publish), &["commit", "-m", "publish asset"]);
    f.svn(Some(&f.publish), &["update"]);
    runtime().block_on(async {
        let data = f.temp.join("data");
        let plan = w::repository_preview(f.publish.clone(), format!("{}/dev", f.url), Some(4))
            .await
            .unwrap();
        let result = w::execute_plan(&data, &plan.id).await.unwrap();
        assert_eq!(result.conflicts, ["asset.uasset"]);
        let conflicts = w::repository_conflicts(f.publish.clone()).await.unwrap();
        assert!(conflicts[0].versions.iter().all(|v| v.text.is_none()));
        let result = w::resolve(
            &data,
            &f.publish,
            "asset.uasset",
            "theirs-full",
            &format!("{}/publish", f.url),
        )
        .await
        .unwrap();
        assert!(result.error.is_none(), "{result:?}");
        assert_eq!(
            fs::read(PathBuf::from(&f.publish).join("asset.uasset")).unwrap(),
            [0, 14, 24]
        );
        let backup = fs::read_dir(data.join("recovery"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(backup.join("manifest.json")).unwrap()).unwrap();
        assert!(!manifest["artifacts"].as_array().unwrap().is_empty());
        for entry in manifest["artifacts"].as_array().unwrap() {
            let saved = backup.join(entry["backup"].as_str().unwrap());
            assert_eq!(
                stash::hash_file(&saved).unwrap(),
                entry["hash"].as_str().unwrap()
            );
        }
    });
}

#[test]
fn tree_conflicts_are_exposed_and_manual_resolution_keeps_the_working_file() {
    let f = Fixture::new();
    f.svn(Some(&f.dev), &["delete", "text.txt"]);
    f.svn(Some(&f.dev), &["commit", "-m", "delete source file"]);
    fs::write(PathBuf::from(&f.publish).join("text.txt"), "keep publish\n").unwrap();
    f.svn(Some(&f.publish), &["commit", "-m", "edit target file"]);
    f.svn(Some(&f.publish), &["update"]);
    runtime().block_on(async {
        let data = f.temp.join("data");
        let plan = w::repository_preview(f.publish.clone(), format!("{}/dev", f.url), Some(4))
            .await
            .unwrap();
        let result = w::execute_plan(&data, &plan.id).await.unwrap();
        assert_eq!(result.conflicts, ["text.txt"]);
        let conflicts = w::repository_conflicts(f.publish.clone()).await.unwrap();
        assert_eq!(conflicts[0].kind, "tree");
        let result = w::resolve(
            &data,
            &f.publish,
            "text.txt",
            "working",
            &format!("{}/publish", f.url),
        )
        .await
        .unwrap();
        assert!(result.error.is_none(), "{result:?}");
        assert!(result.conflicts.is_empty());
        assert_eq!(
            fs::read_to_string(PathBuf::from(&f.publish).join("text.txt")).unwrap(),
            "keep publish\n"
        );
    });
}

#[test]
fn unversioned_delete_rechecks_all_targets_and_protects_nested_repositories() {
    let f = Fixture::new();
    fs::write(f.root().join("local.uasset"), [0, 99]).unwrap();
    fs::create_dir_all(f.root().join("nested/.git")).unwrap();
    runtime().block_on(async {
        assert!(crate::delete_unversioned(
            f.dev.clone(),
            vec!["local.uasset".into(), "text.txt".into()]
        )
        .await
        .is_err());
        assert!(f.root().join("local.uasset").exists());
        assert!(f.root().join("text.txt").exists());
        assert!(
            crate::delete_unversioned(f.dev.clone(), vec!["nested".into()])
                .await
                .is_err()
        );
        assert!(f.root().join("nested/.git").is_dir());
        crate::delete_unversioned(f.dev.clone(), vec!["local.uasset".into()])
            .await
            .unwrap();
        assert!(!f.root().join("local.uasset").exists());
    });
}

#[test]
fn overwrite_confirmation_tracks_property_changes_on_an_added_asset() {
    let f = Fixture::new();
    let data = f.temp.join("data");
    fs::write(f.root().join("new.uasset"), [0, 8, 16]).unwrap();
    f.svn(Some(&f.dev), &["add", "new.uasset"]);
    f.svn(Some(&f.dev), &["propset", "custom", "stash", "new.uasset"]);
    runtime().block_on(async {
        let info = w::identity(&f.dev).await.unwrap();
        let record = stash::create(
            &data,
            &f.dev,
            "added props",
            &["new.uasset".into()],
            &info.url,
        )
        .await
        .unwrap();
        assert_eq!(record.phase, "complete");
        fs::write(f.root().join("new.uasset"), [0, 8, 16]).unwrap();
        f.svn(Some(&f.dev), &["add", "new.uasset"]);
        f.svn(
            Some(&f.dev),
            &["propset", "custom", "local first", "new.uasset"],
        );
        let dir = data.join("stashes/v2").join(&record.id);
        let before = stash::collisions(&dir, &record, &info).await.unwrap();
        assert_eq!(before.len(), 1);
        f.svn(
            Some(&f.dev),
            &["propset", "custom", "local changed again", "new.uasset"],
        );
        assert!(stash::apply(&data, &f.dev, &record.id, true, &before)
            .await
            .is_err());
        assert!(f
            .svn(Some(&f.dev), &["propget", "custom", "new.uasset"])
            .contains("local changed again"));
        assert_eq!(stash::read(&data, &record.id).unwrap().phase, "complete");
    });
}

#[test]
fn file_menu_details_reject_traversal_and_distinguish_binary_and_text() {
    let f = Fixture::new();
    runtime().block_on(async {
        let text = crate::file_actions::workspace_item_details(f.dev.clone(), "text.txt".into())
            .await
            .unwrap();
        assert_eq!(text.kind, "file");
        assert!(text.exists && !text.binary);
        assert!(text.history_url.unwrap().ends_with("/dev/text.txt"));
        let asset =
            crate::file_actions::workspace_item_details(f.dev.clone(), "asset.uasset".into())
                .await
                .unwrap();
        assert!(asset.binary);
        assert!(
            crate::file_actions::workspace_item_details(f.dev.clone(), "../repository".into())
                .await
                .is_err()
        );
    });
}

#[test]
fn svn_ignore_preserves_prior_patterns_and_does_not_hide_tracked_changes() {
    let f = Fixture::new();
    fs::write(f.root().join("new[one].tmp"), "untracked").unwrap();
    fs::write(f.root().join("new.txt"), "untracked").unwrap();
    fs::write(f.root().join("text.txt"), "tracked edit\n").unwrap();
    f.svn(
        Some(&f.dev),
        &["propset", "svn:ignore", "existing-pattern", "."],
    );
    runtime().block_on(async {
        let url = format!("{}/dev", f.url);
        assert!(
            crate::file_actions::ignore(&f.dev, "new[one].tmp", false, "file:///wrong/branch")
                .await
                .is_err()
        );
        assert!(crate::file_actions::ignore(&f.dev, "text.txt", false, &url)
            .await
            .is_err());
        crate::file_actions::ignore(&f.dev, "new[one].tmp", false, &url)
            .await
            .unwrap();
        let status = f.svn(Some(&f.dev), &["status", "--no-ignore", "new[one].tmp"]);
        assert!(status.lines().any(|line| line.starts_with('I')), "{status}");
        crate::file_actions::ignore(&f.dev, "new.txt", true, &url)
            .await
            .unwrap();
        let prop = f.svn(Some(&f.dev), &["propget", "svn:ignore", "."]);
        assert!(prop.contains("existing-pattern") && prop.contains("*.txt"));
        let status = f.svn(Some(&f.dev), &["status", "text.txt"]);
        assert!(status.lines().any(|line| line.starts_with('M')), "{status}");
    });
}

#[test]
fn patch_export_round_trips_text_and_properties_and_refuses_binary_or_overwrite() {
    let f = Fixture::new();
    fs::write(f.root().join("text.txt"), "patched version\n").unwrap();
    fs::write(f.root().join("new@.txt"), "new text\n").unwrap();
    f.svn(Some(&f.dev), &["propset", "custom", "root-value", "."]);
    runtime().block_on(async {
        let destination = f.temp.join("changes.patch");
        let files = vec![".".into(), "text.txt".into(), "new@.txt".into()];
        let url = format!("{}/dev", f.url);
        assert!(crate::file_actions::export_patch(
            &f.dev,
            &files,
            &destination,
            "file:///wrong/branch"
        )
        .await
        .is_err());
        assert!(!destination.exists());
        crate::file_actions::export_patch(&f.dev, &files, &destination, &url)
            .await
            .unwrap();
        let patch = fs::read_to_string(&destination).unwrap();
        crate::svn::apply_patch(&f.publish, &patch, false)
            .await
            .unwrap();
        assert_eq!(
            fs::read_to_string(PathBuf::from(&f.publish).join("text.txt")).unwrap(),
            "patched version\n"
        );
        assert_eq!(
            fs::read_to_string(PathBuf::from(&f.publish).join("new@.txt")).unwrap(),
            "new text\n"
        );
        assert!(f
            .svn(Some(&f.publish), &["propget", "custom", "."])
            .contains("root-value"));
        assert!(
            crate::file_actions::export_patch(&f.dev, &files, &destination, &url)
                .await
                .is_err()
        );
        assert_eq!(fs::read_to_string(&destination).unwrap(), patch);
        let binary_target = f.temp.join("binary.patch");
        assert!(crate::file_actions::export_patch(
            &f.dev,
            &["asset.uasset".into()],
            &binary_target,
            &url
        )
        .await
        .is_err());
        assert!(!binary_target.exists());
        let mut bad_utf8 = vec![b'a'; 9000];
        bad_utf8.push(255);
        fs::write(f.root().join("invalid.txt"), bad_utf8).unwrap();
        assert!(crate::file_actions::export_patch(
            &f.dev,
            &["invalid.txt".into()],
            &binary_target,
            &url
        )
        .await
        .is_err());
        assert!(!binary_target.exists());
    });
}

#[test]
fn discard_folder_selection_preserves_other_panel_and_hidden_changes_without_backups() {
    let f = Fixture::new();
    f.seed_directory();
    runtime().block_on(async {
        fs::write(f.root().join("folder/a.txt"), "changed-a").unwrap();
        fs::write(f.root().join("folder/b.uasset"), [0, 99, 254]).unwrap();
        fs::write(f.root().join("folder/hidden.txt"), "hidden-change").unwrap();
        fs::write(f.root().join("text.txt"), "other-panel").unwrap();
        f.svn(
            Some(&f.dev),
            &["propset", "custom", "saved-property", "folder"],
        );
        let selected = vec![
            "folder".into(),
            "folder/a.txt".into(),
            "folder/b.uasset".into(),
        ];
        let preview = crate::discard::preview(&f.dev, &selected, &format!("{}/dev", f.url))
            .await
            .unwrap();
        assert_eq!(preview.nodes.len(), 3);
        let outcome = crate::discard::execute(&preview.id).await.unwrap();
        assert!(outcome.error.is_none(), "{:?}", outcome.error);
        assert_eq!(outcome.completed_paths.len(), 3);
        assert_eq!(
            fs::read(f.root().join("folder/b.uasset")).unwrap(),
            [0, 8, 255]
        );
        assert_eq!(
            fs::read_to_string(f.root().join("folder/a.txt")).unwrap(),
            "original-a"
        );
        assert_eq!(
            fs::read_to_string(f.root().join("folder/hidden.txt")).unwrap(),
            "hidden-change"
        );
        assert_eq!(
            fs::read_to_string(f.root().join("text.txt")).unwrap(),
            "other-panel"
        );
        assert!(f
            .svn(Some(&f.dev), &["proplist", "folder"])
            .trim()
            .is_empty());
        assert!(!f.temp.join("data").exists());
        let patch = outcome
            .status
            .as_ref()
            .expect("scoped status must be available");
        assert!(patch.subtrees.is_empty());
        assert_eq!(
            patch.paths,
            [".", "folder", "folder/a.txt", "folder/b.uasset"]
        );
        assert!(patch.entries.is_empty());
        assert!(serde_json::to_value(&outcome)
            .unwrap()
            .get("recoveryPath")
            .is_none());
        assert!(crate::discard::execute(&preview.id).await.is_err());
    });
}

#[test]
fn discard_unversioned_directory_includes_all_contents_without_creating_backups() {
    let f = Fixture::new();
    runtime().block_on(async {
        fs::create_dir_all(f.root().join("new/sub/empty")).unwrap();
        fs::write(f.root().join("new/sub/synthetic.uasset"), [0, 255, 88]).unwrap();
        fs::write(f.root().join("new/ignored.tmp"), "included in deletion").unwrap();
        f.svn(
            Some(&f.dev),
            &["propset", "svn:global-ignores", "*.tmp", "."],
        );
        let preview = crate::discard::preview(&f.dev, &["new".into()], &format!("{}/dev", f.url))
            .await
            .unwrap();
        assert_eq!(preview.nodes.len(), 5);
        assert!(preview.nodes.iter().all(|n| n.remove));
        let outcome = crate::discard::execute(&preview.id).await.unwrap();
        assert!(outcome.error.is_none(), "{:?}", outcome.error);
        assert!(!f.root().join("new").exists());
        assert_eq!(outcome.completed_paths.len(), preview.nodes.len());
        assert!(!f.temp.join("data").exists());
        let patch = outcome
            .status
            .as_ref()
            .expect("scoped directory status must be available");
        assert_eq!(patch.subtrees, ["new"]);
        assert_eq!(patch.entries.len(), 1); // Root ignore property remains modified.
        assert_eq!(patch.entries[0].path, ".");
        assert_eq!(patch.entries[0].prop_status, "modified");
    });
}

#[test]
fn discard_added_and_deleted_directories_validate_subtree_scope() {
    let f = Fixture::new();
    f.seed_directory();
    runtime().block_on(async {
        fs::create_dir_all(f.root().join("added/empty")).unwrap();
        fs::write(f.root().join("added/file.txt"), "new-content").unwrap();
        f.svn(Some(&f.dev), &["add", "added"]);
        let url = format!("{}/dev", f.url);
        assert!(crate::discard::preview(&f.dev, &["added".into()], &url)
            .await
            .unwrap_err()
            .contains("requires selecting"));
        assert!(
            crate::discard::preview(&f.dev, &["added/file.txt".into()], &url)
                .await
                .unwrap_err()
                .contains("parent")
        );
        let preview = crate::discard::preview(
            &f.dev,
            &[
                "added".into(),
                "added/empty".into(),
                "added/file.txt".into(),
            ],
            &url,
        )
        .await
        .unwrap();
        let result = crate::discard::execute(&preview.id).await.unwrap();
        assert!(result.error.is_none(), "{:?}", result.error);
        assert!(!f.root().join("added").exists());
        f.svn(Some(&f.dev), &["delete", "folder"]);
        assert_eq!(
            crate::discard::preview(&f.dev, &["folder".into()], &url)
                .await
                .unwrap()
                .nodes
                .len(),
            4
        );
        let files = w::local_status(&f.dev, false)
            .await
            .unwrap()
            .into_iter()
            .filter(|s| s.path == "folder" || s.path.starts_with("folder/"))
            .map(|s| s.path)
            .collect::<Vec<_>>();
        let preview = crate::discard::preview(&f.dev, &files, &url).await.unwrap();
        let result = crate::discard::execute(&preview.id).await.unwrap();
        assert!(result.error.is_none(), "{:?}", result.error);
        assert_eq!(
            fs::read_to_string(f.root().join("folder/a.txt")).unwrap(),
            "original-a"
        );
        assert!(w::local_status(&f.dev, false).await.unwrap().is_empty());
    });
}

#[test]
fn discard_restores_missing_files_and_fully_selected_missing_directories() {
    let f = Fixture::new();
    f.seed_directory();
    runtime().block_on(async {
        fs::remove_file(f.root().join("text.txt")).unwrap();
        let url = format!("{}/dev", f.url);
        let preview = crate::discard::preview(&f.dev, &["text.txt".into()], &url)
            .await
            .unwrap();
        assert!(crate::discard::execute(&preview.id)
            .await
            .unwrap()
            .error
            .is_none());
        assert_eq!(
            fs::read_to_string(f.root().join("text.txt")).unwrap(),
            "base\n"
        );
        // Only remove the known, generated directory inside this test fixture.
        fs::remove_file(f.root().join("folder/a.txt")).unwrap();
        fs::remove_file(f.root().join("folder/b.uasset")).unwrap();
        fs::remove_file(f.root().join("folder/hidden.txt")).unwrap();
        fs::remove_dir(f.root().join("folder")).unwrap();
        let files = w::local_status(&f.dev, true)
            .await
            .unwrap()
            .into_iter()
            .filter(|s| s.path == "folder" || s.path.starts_with("folder/"))
            .map(|s| s.path)
            .collect::<Vec<_>>();
        let preview = crate::discard::preview(&f.dev, &files, &url).await.unwrap();
        let result = crate::discard::execute(&preview.id).await.unwrap();
        assert!(result.error.is_none(), "{:?}", result.error);
        assert_eq!(
            fs::read(f.root().join("folder/b.uasset")).unwrap(),
            [0, 8, 255]
        );
    });
}

#[test]
fn discard_rejects_post_preview_content_property_and_branch_changes() {
    let f = Fixture::new();
    runtime().block_on(async {
        let url = format!("{}/dev", f.url);
        fs::write(f.root().join("text.txt"), "first").unwrap();
        fs::write(f.root().join("asset.uasset"), [0, 77]).unwrap();
        let preview =
            crate::discard::preview(&f.dev, &["text.txt".into(), "asset.uasset".into()], &url)
                .await
                .unwrap();
        fs::write(f.root().join("text.txt"), "second").unwrap();
        assert!(crate::discard::execute(&preview.id).await.is_err());
        assert_eq!(fs::read(f.root().join("asset.uasset")).unwrap(), [0, 77]);
        let preview = crate::discard::preview(&f.dev, &["text.txt".into()], &url)
            .await
            .unwrap();
        f.svn(
            Some(&f.dev),
            &["propset", "custom", "after-preview", "text.txt"],
        );
        assert!(crate::discard::execute(&preview.id).await.is_err());
        assert_eq!(
            fs::read_to_string(f.root().join("text.txt")).unwrap(),
            "second"
        );
        let preview = crate::discard::preview(&f.dev, &["text.txt".into()], &url)
            .await
            .unwrap();
        f.svn(Some(&f.dev), &["switch", &format!("{}/publish", f.url)]);
        assert!(crate::discard::execute(&preview.id).await.is_err());
        assert_eq!(
            fs::read_to_string(f.root().join("text.txt")).unwrap(),
            "second"
        );
    });
}

#[test]
fn discard_rejects_unselected_disk_contents_nested_repositories_and_copy_history() {
    let f = Fixture::new();
    runtime().block_on(async {
        let url = format!("{}/dev", f.url);
        fs::create_dir(f.root().join("added")).unwrap();
        fs::write(f.root().join("added/tracked"), "tracked").unwrap();
        f.svn(Some(&f.dev), &["add", "added"]);
        fs::write(f.root().join("added/hidden.tmp"), "keep me").unwrap();
        assert!(
            crate::discard::preview(&f.dev, &["added".into(), "added/tracked".into()], &url)
                .await
                .is_err()
        );
        assert_eq!(
            fs::read_to_string(f.root().join("added/hidden.tmp")).unwrap(),
            "keep me"
        );
        fs::create_dir_all(f.root().join("new/nested/.git")).unwrap();
        assert!(crate::discard::preview(&f.dev, &["new".into()], &url)
            .await
            .unwrap_err()
            .contains("Nested repository"));
        f.svn(Some(&f.dev), &["copy", "text.txt", "copied.txt"]);
        assert!(
            crate::discard::preview(&f.dev, &["copied.txt".into()], &url)
                .await
                .is_err()
        );
        assert!(
            crate::discard::preview(&f.dev, &["../outside".into()], &url)
                .await
                .is_err()
        );
        assert!(
            crate::discard::preview(&f.dev, &[".svn/wc.db".into()], &url)
                .await
                .is_err()
        );
    });
}

#[test]
fn discard_subdirectory_workspace_and_root_properties_and_cancel() {
    let f = Fixture::new();
    f.seed_directory();
    runtime().block_on(async {
        fs::write(f.root().join("folder/a.txt"), "changed").unwrap();
        let sub = f.root().join("folder").to_string_lossy().into_owned();
        let url = format!("{}/dev/folder", f.url);
        assert_eq!(
            w::identity(&sub).await.unwrap(),
            w::identity(&f.dev).await.unwrap()
        );
        let preview = crate::discard::preview(&sub, &["a.txt".into()], &url)
            .await
            .unwrap();
        assert_eq!(preview.nodes[0].path, "folder/a.txt");
        crate::discard::cancel_workspace_discard(preview.id.clone()).unwrap();
        assert!(crate::discard::execute(&preview.id).await.is_err());
        assert_eq!(
            fs::read_to_string(f.root().join("folder/a.txt")).unwrap(),
            "changed"
        );
        let preview = crate::discard::preview(&sub, &["a.txt".into()], &url)
            .await
            .unwrap();
        assert!(crate::discard::execute(&preview.id)
            .await
            .unwrap()
            .error
            .is_none());
        f.svn(Some(&f.dev), &["propset", "custom", "root-property", "."]);
        fs::write(f.root().join("text.txt"), "keep-child").unwrap();
        let preview = crate::discard::preview(&f.dev, &[".".into()], &format!("{}/dev", f.url))
            .await
            .unwrap();
        assert_eq!(preview.nodes.len(), 1);
        assert!(crate::discard::execute(&preview.id)
            .await
            .unwrap()
            .error
            .is_none());
        assert_eq!(
            fs::read_to_string(f.root().join("text.txt")).unwrap(),
            "keep-child"
        );
    });
}

#[cfg(windows)]
#[test]
fn discard_locked_file_reports_partial_completion_without_creating_backups() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    runtime().block_on(async {
        fs::write(f.root().join("text.txt"), "changed-before-discard").unwrap();
        fs::write(f.root().join("locked.uasset"), [0, 1, 99]).unwrap();
        let preview = crate::discard::preview(
            &f.dev,
            &["text.txt".into(), "locked.uasset".into()],
            &format!("{}/dev", f.url),
        )
        .await
        .unwrap();
        let _lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(f.root().join("locked.uasset"))
            .unwrap();
        let outcome = crate::discard::execute(&preview.id).await.unwrap();
        assert!(outcome.error.is_some());
        assert!(outcome.completed_paths.contains(&"text.txt".to_string()));
        assert!(!outcome
            .completed_paths
            .contains(&"locked.uasset".to_string()));
        assert_eq!(
            fs::read_to_string(f.root().join("text.txt")).unwrap(),
            "base\n"
        );
        assert_eq!(
            fs::read(f.root().join("locked.uasset")).unwrap(),
            [0, 1, 99]
        );
        assert!(!f.temp.join("data").exists());
        assert!(!f.root().join("recovery").exists());
        let patch = outcome
            .status
            .as_ref()
            .expect("partial failure must still refresh status");
        assert_eq!(patch.entries.len(), 1);
        assert_eq!(patch.entries[0].path, "locked.uasset");
        assert_eq!(patch.entries[0].status_code, "unversioned");
    });
}

#[test]
fn discard_protects_hidden_paths_and_does_not_depend_on_backup_storage() {
    let f = Fixture::new();
    f.seed_directory();
    runtime().block_on(async {
        let url = format!("{}/dev", f.url);
        f.svn(Some(&f.dev), &["delete", "folder"]);
        assert!(crate::discard::preview_workspace_discard(
            f.dev.clone(),
            vec!["folder".into()],
            url.clone(),
            vec!["folder/a.txt".into()]
        )
        .await
        .is_err());
        fs::create_dir_all(f.root().join("new/sub")).unwrap();
        fs::write(f.root().join("new/sub/keep.txt"), "protected").unwrap();
        assert!(crate::discard::preview_workspace_discard(
            f.dev.clone(),
            vec!["new".into()],
            url.clone(),
            vec!["new/sub/keep.txt".into()]
        )
        .await
        .is_err());
        fs::write(f.root().join("text.txt"), "must-survive").unwrap();
        let preview = crate::discard::preview(&f.dev, &["text.txt".into()], &url)
            .await
            .unwrap();
        let blocked_data = f.temp.join("not-a-directory");
        fs::write(&blocked_data, "unavailable backup storage").unwrap();
        let old_backup = f.temp.join("data/recovery/discard-existing/0");
        fs::create_dir_all(old_backup.parent().unwrap()).unwrap();
        fs::write(&old_backup, "existing backup must remain unchanged").unwrap();
        let outcome = crate::discard::execute_workspace_discard(preview.id)
            .await
            .unwrap();
        assert!(outcome.error.is_none(), "{:?}", outcome.error);
        assert_eq!(
            fs::read_to_string(f.root().join("text.txt")).unwrap(),
            "base\n"
        );
        assert_eq!(
            fs::read_to_string(blocked_data).unwrap(),
            "unavailable backup storage"
        );
        assert_eq!(
            fs::read_to_string(old_backup).unwrap(),
            "existing backup must remain unchanged"
        );
        assert_eq!(
            fs::read_dir(f.temp.join("data/recovery")).unwrap().count(),
            1
        );
    });
}

#[test]
fn discard_status_from_a_subdirectory_maps_paths_and_leaves_unrelated_trees_unqueried() {
    let f = Fixture::new();
    f.seed_directory();
    runtime().block_on(async {
        fs::write(f.root().join("folder/a.txt"), "changed").unwrap();
        fs::write(f.root().join("folder/hidden.txt"), "keep-hidden").unwrap();
        fs::create_dir(f.root().join("unrelated")).unwrap();
        for index in 0..128 {
            fs::write(f.root().join(format!("unrelated/{index}.txt")), "untouched").unwrap();
        }
        let sub = f.root().join("folder").to_string_lossy().into_owned();
        let url = format!("{}/dev/folder", f.url);
        let preview = crate::discard::preview(&sub, &["a.txt".into()], &url)
            .await
            .unwrap();
        let outcome = crate::discard::execute(&preview.id).await.unwrap();
        assert!(outcome.error.is_none());
        let patch = outcome.status.unwrap();
        assert_eq!(patch.workspace, sub);
        assert_eq!(patch.expected_url, url);
        assert_eq!(patch.paths, [".", "a.txt"]);
        assert!(patch.subtrees.is_empty());
        assert!(patch.entries.is_empty());
        let full = w::local_status(&sub, false).await.unwrap();
        assert_eq!(full.len(), 1);
        assert_eq!(full[0].path, "hidden.txt");
        assert_eq!(
            fs::read_dir(f.root().join("unrelated")).unwrap().count(),
            128
        );
    });
}

#[test]
#[ignore = "explicit synthetic performance measurement; never opens a user workspace"]
fn benchmark_discard_refresh_in_synthetic_repository() {
    let f = Fixture::new();
    fs::create_dir(f.root().join("unrelated")).unwrap();
    for index in 0..10_000 {
        fs::write(f.root().join(format!("unrelated/{index}.txt")), "synthetic").unwrap();
    }
    f.svn(Some(&f.dev), &["add", "unrelated"]);
    f.svn(
        Some(&f.dev),
        &["commit", "-m", "synthetic performance dataset"],
    );
    f.svn(Some(&f.dev), &["update"]);
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_test_writer()
        .finish();
    tracing::subscriber::with_default(subscriber, || {
        runtime().block_on(async {
        // Warm filesystem caches; these are native query timings, not WebView
        // interaction timings. Scope refresh always precedes the full scan.
        crate::svn::cached_status(&f.dev, true, None).await.unwrap();
        for round in 0..3 {
            fs::write(f.root().join("text.txt"), format!("changed-{round}")).unwrap();
            let preview = crate::discard::preview(&f.dev, &["text.txt".into()], &format!("{}/dev", f.url)).await.unwrap();
            let outcome = crate::discard::execute(&preview.id).await.unwrap();
            assert!(outcome.error.is_none());
            let patch = outcome.status.unwrap();
            assert_eq!(patch.paths, [".", "text.txt"]);
            assert!(patch.subtrees.is_empty());
            let start = std::time::Instant::now();
            let status_path = f.dev.clone();
            let info_path = f.dev.clone();
            let full_task = tokio::spawn(async move { crate::svn::cached_status(&status_path, true, None).await });
            let info_task = tokio::spawn(async move { crate::svn::info(&info_path).await });
            crate::svn::local_revision(&f.dev).await.unwrap();
            let full = full_task.await.unwrap().unwrap();
            info_task.await.unwrap().unwrap();
            println!("SYNTHETIC_DISCARD_REFRESH round={round} unrelated_files=10000 full_refresh_ms={}", start.elapsed().as_millis());
            assert!(full.is_empty());
        }
    })
    });
}

#[test]
fn discard_new_unversioned_contents_after_preview_and_subdirectory_property_scope() {
    let f = Fixture::new();
    f.seed_directory();
    runtime().block_on(async {
        let url = format!("{}/dev", f.url);
        fs::create_dir(f.root().join("new")).unwrap();
        fs::write(f.root().join("new/one.txt"), "first").unwrap();
        let preview = crate::discard::preview(&f.dev, &["new".into()], &url)
            .await
            .unwrap();
        fs::write(f.root().join("new/two.txt"), "late-content").unwrap();
        assert!(crate::discard::execute(&preview.id).await.is_err());
        assert_eq!(
            fs::read_to_string(f.root().join("new/one.txt")).unwrap(),
            "first"
        );
        assert_eq!(
            fs::read_to_string(f.root().join("new/two.txt")).unwrap(),
            "late-content"
        );
        f.svn(
            Some(&f.dev),
            &["propset", "custom", "sub-property", "folder"],
        );
        fs::write(f.root().join("folder/a.txt"), "keep-child").unwrap();
        f.svn(Some(&f.dev), &["propset", "custom", "root-property", "."]);
        let child_preview = crate::discard::preview_workspace_discard(
            f.dev.clone(),
            vec!["folder/a.txt".into()],
            url.clone(),
            vec![".".into(), "folder".into()],
        )
        .await
        .unwrap();
        assert!(crate::discard::execute(&child_preview.id)
            .await
            .unwrap()
            .error
            .is_none());
        assert!(f
            .svn(Some(&f.dev), &["propget", "custom", "."])
            .contains("root-property"));
        assert!(f
            .svn(Some(&f.dev), &["propget", "custom", "folder"])
            .contains("sub-property"));
        fs::write(f.root().join("folder/a.txt"), "keep-child").unwrap();
        let sub = f.root().join("folder").to_string_lossy().into_owned();
        let preview = crate::discard::preview(&sub, &[".".into()], &format!("{url}/folder"))
            .await
            .unwrap();
        assert_eq!(preview.nodes[0].path, "folder");
        assert!(crate::discard::execute(&preview.id)
            .await
            .unwrap()
            .error
            .is_none());
        assert_eq!(
            fs::read_to_string(f.root().join("folder/a.txt")).unwrap(),
            "keep-child"
        );
    });
}

#[test]
fn discard_status_scope_avoids_unrelated_subtrees_but_expands_structural_targets() {
    let f = Fixture::new();
    f.seed_directory();
    runtime().block_on(async {
        fs::write(f.root().join("text.txt"), "selected").unwrap();
        fs::write(f.root().join("folder/a.txt"), "unselected").unwrap();
        let identity = w::identity(&f.dev).await.unwrap();
        let statuses = crate::discard::selection_status(&identity, &["text.txt".into()])
            .await
            .unwrap();
        assert!(statuses
            .iter()
            .any(|s| s.path == "text.txt" && s.status_code == "modified"));
        assert!(statuses
            .iter()
            .all(|s| s.path == "." || s.path == "text.txt"));
        f.svn(Some(&f.dev), &["delete", "--force", "folder"]);
        let statuses = crate::discard::selection_status(&identity, &["folder".into()])
            .await
            .unwrap();
        for child in [
            "folder",
            "folder/a.txt",
            "folder/b.uasset",
            "folder/hidden.txt",
        ] {
            assert!(statuses
                .iter()
                .any(|s| s.path == child && s.status_code == "deleted"));
        }
        assert!(!statuses.iter().any(|s| s.path == "text.txt"));
    });
}

#[test]
fn keeping_current_binary_conflict_result_preserves_edits_and_backup_bytes() {
    let f = Fixture::new();
    fs::write(f.root().join("asset.uasset"), [0, 14, 24]).unwrap();
    f.svn(Some(&f.dev), &["commit", "-m", "synthetic incoming binary"]);
    fs::write(PathBuf::from(&f.publish).join("asset.uasset"), [0, 34, 44]).unwrap();
    f.svn(
        Some(&f.publish),
        &["commit", "-m", "synthetic local binary"],
    );
    f.svn(Some(&f.publish), &["update"]);
    runtime().block_on(async {
        let data = f.temp.join("data");
        let plan = w::repository_preview(f.publish.clone(), format!("{}/dev", f.url), Some(4))
            .await
            .unwrap();
        let merged = w::execute_plan(&data, &plan.id).await.unwrap();
        assert_eq!(merged.conflicts, ["asset.uasset"]);
        // Simulate additional edits after the conflict, such as a local rebuild.
        let working = PathBuf::from(&f.publish).join("asset.uasset");
        let desired = [0, 97, 98, 255, 99];
        fs::write(&working, desired).unwrap();
        let before = stash::hash_file(&working).unwrap();
        let result = w::resolve(
            &data,
            &f.publish,
            "asset.uasset",
            "working",
            &format!("{}/publish", f.url),
        )
        .await
        .unwrap();
        assert!(result.error.is_none(), "{result:?}");
        assert!(result.conflicts.is_empty());
        assert_eq!(fs::read(&working).unwrap(), desired);
        assert_eq!(stash::hash_file(&working).unwrap(), before);
        let recoveries = fs::read_dir(data.join("recovery")).unwrap();
        let mut found = false;
        for recovery in recoveries {
            let path = recovery.unwrap().path();
            if path.join("working-file").exists() {
                assert_eq!(fs::read(path.join("working-file")).unwrap(), desired);
                let manifest: serde_json::Value =
                    serde_json::from_slice(&fs::read(path.join("manifest.json")).unwrap()).unwrap();
                assert_eq!(manifest["strategy"], "working");
                assert!(!manifest["artifacts"].as_array().unwrap().is_empty());
                for artifact in manifest["artifacts"].as_array().unwrap() {
                    assert_eq!(
                        stash::hash_file(&path.join(artifact["backup"].as_str().unwrap())).unwrap(),
                        artifact["hash"].as_str().unwrap()
                    );
                }
                found = true;
            }
        }
        assert!(found, "resolution backup was not retained");
    });
}
