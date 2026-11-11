use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{OnceLock, RwLock};
use std::time::Duration;
use thiserror::Error;
use tokio::process::Command;
use tokio::time::timeout;

pub const SVN_TIMEOUT: Duration = Duration::from_secs(120);
static SVN_EXECUTABLE: OnceLock<RwLock<PathBuf>> = OnceLock::new();

#[derive(Error, Debug)]
pub enum SvnError {
    #[error("SVN 命令执行失败：{0}")]
    CommandFailed(String),
    #[error("SVN 未安装或不在 PATH 中")]
    SvnNotFound,
    #[error("解析输出失败：{0}")]
    ParseError(String),
    #[error("无效的 SVN 参数：{0}")]
    InvalidArguments(String),
    #[error("SVN 操作超时")]
    Timeout,
}

pub async fn execute_svn(args: &[&str], path: Option<&str>) -> Result<String, SvnError> {
    #[cfg(test)]
    if let Some(path) = path {
        let mut capture = TEST_COMMANDS.lock().unwrap();
        if let Some(commands) = capture.get_mut(&test_root_key(path)) {
            commands.push(args.iter().map(|s| s.to_string()).collect());
        }
    }
    let executable = current_svn_executable()?;
    let result = execute_svn_inner(executable, args, path).await;
    #[cfg(test)]
    if result.is_ok() && args.first() == Some(&"commit") {
        let action = path.and_then(|p| AFTER_TEST_COMMIT.lock().unwrap().remove(p));
        if let Some(action) = action {
            action();
        }
    }
    result
}

#[cfg(test)]
type TestAction = Box<dyn FnOnce() + Send>;
#[cfg(test)]
static AFTER_TEST_COMMIT: std::sync::Mutex<std::collections::BTreeMap<String, TestAction>> =
    std::sync::Mutex::new(std::collections::BTreeMap::new());
#[cfg(test)]
pub(crate) fn after_test_commit(root: &str, action: impl FnOnce() + Send + 'static) {
    AFTER_TEST_COMMIT
        .lock()
        .unwrap()
        .insert(root.into(), Box::new(action));
}

#[cfg(test)]
static TEST_COMMANDS: std::sync::Mutex<std::collections::BTreeMap<String, Vec<Vec<String>>>> =
    std::sync::Mutex::new(std::collections::BTreeMap::new());
#[cfg(test)]
fn test_root_key(root: &str) -> String {
    #[cfg(windows)]
    {
        crate::strip_verbatim_prefix(root)
            .replace('\\', "/")
            .to_lowercase()
    }
    #[cfg(not(windows))]
    {
        root.to_string()
    }
}
#[cfg(test)]
pub(crate) fn capture_commands(root: &str) {
    TEST_COMMANDS
        .lock()
        .unwrap()
        .insert(test_root_key(root), Vec::new());
}
#[cfg(test)]
pub(crate) fn take_commands(root: &str) -> Vec<Vec<String>> {
    TEST_COMMANDS
        .lock()
        .unwrap()
        .remove(&test_root_key(root))
        .unwrap_or_default()
}

/// Use the companion belonging to the configured SVN installation. This reads
/// local BASE metadata; it does not contact a repository or modify files.
pub(super) async fn execute_svnversion(path: &str) -> Result<String, SvnError> {
    let svn = current_svn_executable()?;
    let name = if cfg!(windows) {
        "svnversion.exe"
    } else {
        "svnversion"
    };
    let executable = svn
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.join(name))
        .unwrap_or_else(|| PathBuf::from(name));
    let mut cmd = Command::new(executable);
    cmd.args(["--no-newline", "."])
        .current_dir(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    #[cfg(unix)]
    cmd.env(
        "LC_ALL",
        if cfg!(target_os = "macos") {
            "en_US.UTF-8"
        } else {
            "C.UTF-8"
        },
    );
    collect_command_output(&mut cmd, SVN_TIMEOUT).await
}

pub async fn configure_svn_executable(executable: Option<&str>) -> Result<String, SvnError> {
    let executable = normalize_svn_executable(executable);

    let version = execute_svn_inner(executable.clone(), &["--version", "--quiet"], None).await?;

    let mut configured = svn_executable_lock()
        .write()
        .map_err(|_| SvnError::CommandFailed("SVN 可执行文件配置锁已损坏".to_string()))?;
    *configured = executable;
    Ok(version.trim().to_string())
}

/// svnmucc's cp fails atomically if DST exists; svn copy may instead nest SRC
/// beneath it when another client creates DST after a preflight check.
pub(crate) async fn copy_repository(
    path: &str,
    source: &str,
    revision: u64,
    destination: &str,
    message: &str,
) -> Result<String, SvnError> {
    let svn = current_svn_executable()?;
    let name = if cfg!(windows) {
        "svnmucc.exe"
    } else {
        "svnmucc"
    };
    let executable = svn
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.join(name))
        .unwrap_or_else(|| PathBuf::from(name));
    execute_svn_inner(
        executable,
        &[
            "-m",
            message,
            "cp",
            &revision.to_string(),
            source,
            destination,
        ],
        Some(path),
    )
    .await
    .map_err(|error| match error {
        SvnError::SvnNotFound => SvnError::CommandFailed(
            "Atomic repository copy requires svnmucc alongside the configured SVN executable"
                .into(),
        ),
        other => other,
    })
}

fn normalize_svn_executable(executable: Option<&str>) -> PathBuf {
    executable
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("svn"))
}

fn svn_executable_lock() -> &'static RwLock<PathBuf> {
    SVN_EXECUTABLE.get_or_init(|| RwLock::new(PathBuf::from("svn")))
}

pub(super) fn current_svn_executable() -> Result<PathBuf, SvnError> {
    svn_executable_lock()
        .read()
        .map(|path| path.clone())
        .map_err(|_| SvnError::CommandFailed("SVN 可执行文件配置锁已损坏".to_string()))
}

fn build_command_args(args: &[String]) -> Vec<String> {
    let mut command_args = vec!["--non-interactive".to_string()];
    command_args.extend(args.iter().cloned());
    command_args
}

async fn execute_svn_inner(
    executable: PathBuf,
    args: &[&str],
    path: Option<&str>,
) -> Result<String, SvnError> {
    let args_vec: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let mut cmd = Command::new(&executable);
    cmd.args(build_command_args(&args_vec));
    // SVN converts paths and messages using the process locale. Desktop launches
    // may inherit no locale, an ASCII locale, or a non-UTF-8 locale even though
    // Rust passes UTF-8 arguments. Override LC_ALL (which takes precedence over
    // LANG and LC_CTYPE) for the child only, keeping its output UTF-8 as well.
    #[cfg(unix)]
    {
        // macOS ships en_US.UTF-8; C.UTF-8 is available on Linux without
        // installing or generating an additional language locale.
        #[cfg(target_os = "macos")]
        const SVN_LOCALE: &str = "en_US.UTF-8";
        #[cfg(not(target_os = "macos"))]
        const SVN_LOCALE: &str = "C.UTF-8";
        cmd.env("LC_ALL", SVN_LOCALE);
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    // Dropping the output future on timeout kills the child rather than leaving
    // an SVN process running. Tokio drains stdout and stderr concurrently.
    cmd.kill_on_drop(true);
    if let Some(path) = path {
        cmd.current_dir(path);
    }

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let deadline = if args
        .iter()
        .any(|arg| matches!(*arg, "switch" | "merge" | "export" | "checkout"))
    {
        Duration::from_secs(1800)
    } else {
        SVN_TIMEOUT
    };
    let output = if args.iter().any(|arg| {
        matches!(
            *arg,
            "switch"
                | "merge"
                | "update"
                | "commit"
                | "checkout"
                | "revert"
                | "add"
                | "resolve"
                | "cleanup"
        )
    }) {
        collect_streamed_output(&mut cmd, deadline, path.unwrap_or("")).await?
    } else {
        collect_command_output(&mut cmd, deadline).await?
    };
    if output.trim().is_empty() && always_prints_output(&args_vec) {
        return Err(SvnError::CommandFailed(format!(
            "SVN 命令成功退出但没有任何输出：svn {}\n{} 的输出未能送达 OrcaSVN，可能是透明加密或数据防泄漏软件的进程策略所致。请联系管理员，将 OrcaSVN 及其启动的 SVN 程序加入策略。",
            args_vec.join(" "),
            executable.display()
        )));
    }
    Ok(output)
}

/// Commands whose successful output is never empty. With some transparent
/// encryption agents, `svn.exe` started by an unlisted parent exits with 0 without
/// delivering any stdout. The XML parsers accept empty input, so this would
/// otherwise look like a clean working copy. Report it rather than work around it:
/// the agent's policy is the owner's to change.
fn always_prints_output(args: &[String]) -> bool {
    args.iter().any(|arg| arg == "--xml" || arg == "--version")
}

async fn collect_command_output(cmd: &mut Command, deadline: Duration) -> Result<String, SvnError> {
    let output = timeout(deadline, cmd.output())
        .await
        .map_err(|_| SvnError::Timeout)?
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                SvnError::SvnNotFound
            } else {
                SvnError::CommandFailed(error.to_string())
            }
        })?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if output.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(SvnError::CommandFailed(format!("{}\n{}", stdout, stderr)))
    }
}

async fn collect_streamed_output(
    cmd: &mut Command,
    deadline: Duration,
    workspace: &str,
) -> Result<String, SvnError> {
    use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
    async fn drain(reader: impl AsyncRead + Unpin, workspace: String) -> std::io::Result<Vec<u8>> {
        let mut reader = BufReader::new(reader);
        let mut all = Vec::new();
        let mut line = Vec::new();
        let mut pending = Vec::new();
        let mut last_emit = std::time::Instant::now();
        loop {
            line.clear();
            if reader.read_until(b'\n', &mut line).await? == 0 {
                break;
            }
            pending.extend_from_slice(&line);
            if pending.len() >= 8192 || last_emit.elapsed() >= Duration::from_millis(80) {
                crate::workflows::command_output(&workspace, &String::from_utf8_lossy(&pending));
                pending.clear();
                last_emit = std::time::Instant::now();
            }
            all.extend_from_slice(&line);
        }
        if !pending.is_empty() {
            crate::workflows::command_output(&workspace, &String::from_utf8_lossy(&pending));
        }
        Ok(all)
    }
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            SvnError::SvnNotFound
        } else {
            SvnError::CommandFailed(e.to_string())
        }
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| SvnError::CommandFailed("Missing stdout pipe".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| SvnError::CommandFailed("Missing stderr pipe".into()))?;
    let mut out_task = tokio::spawn(drain(stdout, workspace.to_owned()));
    let mut err_task = tokio::spawn(drain(stderr, workspace.to_owned()));
    let result = timeout(deadline, async {
        let status = child.wait().await?;
        let out = (&mut out_task).await.map_err(std::io::Error::other)??;
        let err = (&mut err_task).await.map_err(std::io::Error::other)??;
        Ok::<_, std::io::Error>((status, out, err))
    })
    .await;
    out_task.abort();
    err_task.abort();
    let (status, out, err) = result
        .map_err(|_| SvnError::Timeout)?
        .map_err(|e| SvnError::CommandFailed(e.to_string()))?;
    let out = String::from_utf8_lossy(&out).into_owned();
    if status.success() {
        Ok(out)
    } else {
        Err(SvnError::CommandFailed(format!(
            "{out}\n{}",
            String::from_utf8_lossy(&err)
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn streaming_output_preserves_stdout_and_nonzero_stderr() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        #[cfg(windows)]
        let mut command = {
            let mut cmd = Command::new("cmd");
            cmd.args([
                "/D",
                "/C",
                "echo synthetic-stdout & echo synthetic-stderr 1>&2 & exit /b 7",
            ]);
            cmd
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut cmd = Command::new("sh");
            cmd.args([
                "-c",
                "printf synthetic-stdout; printf synthetic-stderr >&2; exit 7",
            ]);
            cmd
        };
        command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let error = runtime
            .block_on(collect_streamed_output(
                &mut command,
                Duration::from_secs(10),
                "synthetic-test-only",
            ))
            .unwrap_err()
            .to_string();
        assert!(error.contains("synthetic-stdout"));
        assert!(error.contains("synthetic-stderr"));
    }

    #[test]
    fn empty_output_is_only_an_error_for_commands_that_always_print() {
        let args = |list: &[&str]| list.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
        assert!(always_prints_output(&args(&["status", "--xml"])));
        assert!(always_prints_output(&args(&["info", "--xml"])));
        assert!(always_prints_output(&args(&["--version", "--quiet"])));
        assert!(!always_prints_output(&args(&["diff"])));
        assert!(!always_prints_output(&args(&[
            "info",
            "--show-item",
            "revision"
        ])));
    }

    // A stand-in for the affected Windows behaviour: exit 0 with no stdout.
    #[cfg(unix)]
    #[test]
    fn silent_svn_is_reported_instead_of_parsed_as_a_clean_working_copy() {
        use std::os::unix::fs::PermissionsExt;
        let directory =
            std::env::temp_dir().join(format!("orcasvn-silent-svn-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let fake = directory.join("svn");
        std::fs::write(&fake, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let status = runtime.block_on(execute_svn_inner(fake.clone(), &["status", "--xml"], None));
        assert!(status.unwrap_err().to_string().contains("没有任何输出"));
        let diff = runtime.block_on(execute_svn_inner(fake, &["diff"], None));
        assert_eq!(diff.unwrap(), "");
        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn non_ascii_paths_work_without_a_utf8_parent_locale() {
        const CHILD_MARKER: &str = "ORCASVN_ENCODING_TEST_CHILD";
        if std::env::var_os(CHILD_MARKER).is_none() {
            for executable in ["svn", "svnadmin"] {
                if std::process::Command::new(executable)
                    .arg("--version")
                    .output()
                    .is_err()
                {
                    eprintln!("Skipping encoding regression test: {executable} is unavailable");
                    return;
                }
            }
            // Isolate parent locale changes from other tests running in parallel.
            for locale in [None, Some("C"), Some("invalid_ORCASVN_locale")] {
                let mut child = std::process::Command::new(std::env::current_exe().unwrap());
                child.args([
                    "--exact",
                    "svn::executor::tests::non_ascii_paths_work_without_a_utf8_parent_locale",
                    "--nocapture",
                ]);
                child.env(CHILD_MARKER, "1");
                for variable in ["LC_ALL", "LC_CTYPE", "LANG"] {
                    match locale {
                        Some(value) => {
                            child.env(variable, value);
                        }
                        None => {
                            child.env_remove(variable);
                        }
                    }
                }
                let output = child.output().unwrap();
                assert!(
                    output.status.success(),
                    "encoding regression failed with parent locale {locale:?}:\n{}\n{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
            }
            return;
        }

        let directory = std::env::temp_dir().join(format!(
            "orcasvn-encoding-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(directory.clone());
        let repository = directory.join("repository");
        let created = std::process::Command::new("svnadmin")
            .arg("create")
            .arg(&repository)
            .output()
            .unwrap();
        assert!(created.status.success());
        let url = format!("file://{}", repository.to_str().unwrap());
        let wc = directory.join("工作副本");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let run = |args: &[&str], path: Option<&str>| {
            runtime
                .block_on(execute_svn_inner(PathBuf::from("svn"), args, path))
                .unwrap()
        };
        run(&["checkout", &url, wc.to_str().unwrap()], None);
        std::fs::create_dir(wc.join("子目录")).unwrap();
        std::fs::write(wc.join("子目录/文件.xlsx"), "中文内容").unwrap();
        run(&["add", "子目录"], Some(wc.to_str().unwrap()));
        run(
            &["commit", "-m", "提交中文文件", "子目录/文件.xlsx", "子目录"],
            Some(wc.to_str().unwrap()),
        );
        let log = run(&["log", "--xml", "-v", &url], None);
        assert!(log.contains("提交中文文件"));
        assert!(log.contains("/子目录/文件.xlsx"));
        let second_wc = directory.join("第二副本");
        run(
            &[
                "checkout",
                &format!("{url}/子目录"),
                second_wc.to_str().unwrap(),
            ],
            None,
        );
        assert_eq!(
            std::fs::read_to_string(second_wc.join("文件.xlsx")).unwrap(),
            "中文内容"
        );
    }

    #[test]
    fn captures_svn_stdout() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("failed to build tokio runtime");

        let result = runtime.block_on(execute_svn(&["--version", "--quiet"], None));

        match result {
            Ok(output) => assert!(!output.trim().is_empty()),
            Err(SvnError::SvnNotFound) => {}
            Err(err) => panic!("unexpected svn executor error: {err}"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn drains_large_stdout_and_stderr_without_blocking() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let mut command = Command::new("sh");
        command.args([
            "-c",
            "i=0; while [ $i -lt 10000 ]; do echo output; echo error >&2; i=$((i+1)); done",
        ]);
        command.kill_on_drop(true);
        let output = runtime
            .block_on(collect_command_output(
                &mut command,
                Duration::from_secs(10),
            ))
            .unwrap();
        assert_eq!(output.lines().count(), 10000);
    }

    #[cfg(unix)]
    #[test]
    fn timeout_kills_the_child() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let mut command = Command::new("sh");
        command.args(["-c", "echo $$; exec sleep 10"]);
        command.kill_on_drop(true);
        // Spawn explicitly so the test can check that the timed-out PID exits.
        command.stdout(Stdio::piped());
        runtime.block_on(async {
            let child = command.spawn().unwrap();
            let pid = child.id().unwrap();
            assert!(timeout(Duration::from_millis(30), child.wait_with_output())
                .await
                .is_err());
            for _ in 0..100 {
                let alive = std::process::Command::new("kill")
                    .args(["-0", &pid.to_string()])
                    .output()
                    .unwrap()
                    .status
                    .success();
                if !alive {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            panic!("timed-out child is still alive");
        });
    }

    #[test]
    fn empty_executable_uses_default_command() {
        assert_eq!(normalize_svn_executable(Some("   ")), Path::new("svn"));
        assert_eq!(normalize_svn_executable(None), Path::new("svn"));
    }

    #[test]
    fn configured_executable_is_trimmed() {
        assert_eq!(
            normalize_svn_executable(Some("  C:\\Tools\\svn.exe  ")),
            Path::new("C:\\Tools\\svn.exe")
        );
    }

    #[test]
    fn global_options_precede_target_separator() {
        let args = vec![
            "diff".to_string(),
            "-c".to_string(),
            "12".to_string(),
            "--".to_string(),
            "https://example.test/repo/file@12".to_string(),
        ];

        assert_eq!(
            build_command_args(&args),
            [
                "--non-interactive",
                "diff",
                "-c",
                "12",
                "--",
                "https://example.test/repo/file@12"
            ]
        );
    }
}
