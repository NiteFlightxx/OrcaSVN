use std::process::Command;
use std::time::Duration;
use thiserror::Error;
use tokio::task::spawn_blocking;

pub const SVN_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Error, Debug)]
pub enum SvnError {
    #[error("SVN 命令执行失败：{0}")]
    CommandFailed(String),
    #[error("SVN 未安装或不在 PATH 中")]
    SvnNotFound,
    #[error("解析输出失败：{0}")]
    ParseError(String),
    #[error("SVN 操作超时")]
    Timeout,
}

pub async fn execute_svn(args: &[&str], path: Option<&str>) -> Result<String, SvnError> {
    execute_svn_inner(args, path, false).await
}

pub async fn execute_svn_allow_diff(args: &[&str], path: Option<&str>) -> Result<String, SvnError> {
    execute_svn_inner(args, path, true).await
}

async fn execute_svn_inner(args: &[&str], path: Option<&str>, allow_diff_exit: bool) -> Result<String, SvnError> {
    let args_vec: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let path_str = path.map(|s| s.to_string());

    let result = tokio::time::timeout(SVN_TIMEOUT, spawn_blocking(move || {
        let mut cmd = Command::new("svn");
        cmd.args(&args_vec);
        cmd.arg("--non-interactive");

        if let Some(p) = path_str.as_ref() {
            cmd.current_dir(p);
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let output = cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                SvnError::SvnNotFound
            } else {
                SvnError::CommandFailed(e.to_string())
            }
        })?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() {
            Ok(stdout)
        } else if allow_diff_exit && output.status.code() == Some(1) {
            Ok(stdout)
        } else {
            Err(SvnError::CommandFailed(format!(
                "{}\n{}",
                stdout, stderr
            )))
        }
    }))
    .await
    .map_err(|_| SvnError::Timeout)?
    .map_err(|e| SvnError::CommandFailed(format!("SVN 进程异常退出：{}", e)))?;

    result
}
