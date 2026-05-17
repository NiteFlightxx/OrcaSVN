use crate::{DiffResult, SvnInfo, SvnLogEntry, SvnStatus};
use serde::{Deserialize, Serialize};

use super::executor::{execute_svn, execute_svn_allow_diff, SvnError};
use super::parser::{parse_blame_text, parse_info_xml, parse_log_xml, parse_status_xml};

pub async fn checkout(url: &str, path: &str, revision: Option<u64>) -> Result<String, SvnError> {
    let mut args: Vec<String> = vec!["checkout".to_string(), url.to_string(), path.to_string()];

    if let Some(rev) = revision {
        args.insert(1, "-r".to_string());
        args.insert(2, rev.to_string());
    }

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    execute_svn(&args_refs, None).await
}

pub async fn update(path: &str, revision: Option<u64>) -> Result<String, SvnError> {
    let mut args: Vec<String> = vec!["update".to_string()];

    if let Some(rev) = revision {
        args.push("-r".to_string());
        args.push(rev.to_string());
    }

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    execute_svn(&args_refs, Some(path)).await
}

pub async fn commit(path: &str, message: &str, files: Option<&[String]>) -> Result<String, SvnError> {
    let mut args: Vec<String> = vec!["commit".to_string(), "-m".to_string(), message.to_string()];

    if let Some(file_list) = files {
        for file in file_list {
            args.push(file.clone());
        }
    }

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    execute_svn(&args_refs, Some(path)).await
}

pub async fn status(path: &str) -> Result<Vec<SvnStatus>, SvnError> {
    let args = vec!["status", "--xml"];
    let output = execute_svn(&args, Some(path)).await?;
    parse_status_xml(&output)
}

pub async fn log(
    path: &str,
    limit: Option<u32>,
    start_rev: Option<u64>,
    end_rev: Option<u64>,
) -> Result<Vec<SvnLogEntry>, SvnError> {
    let mut args: Vec<String> = vec!["log".to_string(), "--xml".to_string()];

    if let Some(lim) = limit {
        args.push("-l".to_string());
        args.push(lim.to_string());
    }

    if let Some(start) = start_rev {
        if let Some(end) = end_rev {
            args.push("-r".to_string());
            args.push(format!("{}:{}", start, end));
        } else {
            args.push("-r".to_string());
            args.push(format!("{}:HEAD", start));
        }
    }

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = execute_svn(&args_refs, Some(path)).await?;
    parse_log_xml(&output)
}

pub async fn info(path: &str) -> Result<SvnInfo, SvnError> {
    let args = vec!["info", "--xml"];
    let output = execute_svn(&args, Some(path)).await?;
    parse_info_xml(&output)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlameLine {
    pub revision: u64,
    pub author: String,
    pub line: String,
}

pub async fn blame(workspace: &str, file: &str) -> Result<Vec<BlameLine>, SvnError> {
    let args = vec!["blame", file];
    let output = execute_svn(&args, Some(workspace)).await?;
    parse_blame_text(&output)
}

pub async fn diff(workspace: &str, file: &str, old_rev: Option<u64>, new_rev: Option<u64>) -> Result<DiffResult, SvnError> {
    let mut args: Vec<String> = vec!["diff".to_string()];

    if let Some(old) = old_rev {
        if let Some(new) = new_rev {
            args.push("-r".to_string());
            args.push(format!("{}:{}", old, new));
        } else {
            args.push("-c".to_string());
            args.push(old.to_string());
        }
    }

    args.push(file.to_string());

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = execute_svn_allow_diff(&args_refs, Some(workspace)).await?;

    Ok(DiffResult {
        path: file.to_string(),
        diff: output,
        old_revision: old_rev.unwrap_or(0),
        new_revision: new_rev.unwrap_or(0),
    })
}

pub async fn add(path: &str, files: &[String]) -> Result<String, SvnError> {
    let mut args: Vec<String> = vec!["add".to_string()];
    for file in files {
        args.push(file.clone());
    }
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    execute_svn(&args_refs, Some(path)).await
}

pub async fn delete(path: &str, files: &[String]) -> Result<String, SvnError> {
    let mut args: Vec<String> = vec!["delete".to_string()];
    for file in files {
        args.push(file.clone());
    }
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    execute_svn(&args_refs, Some(path)).await
}

pub async fn revert(path: &str, files: &[String]) -> Result<String, SvnError> {
    let mut args: Vec<String> = vec!["revert".to_string()];
    for file in files {
        args.push(file.clone());
    }
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    execute_svn(&args_refs, Some(path)).await
}

pub async fn resolve(path: &str, files: &[String], strategy: &str) -> Result<String, SvnError> {
    let mut args: Vec<String> = vec!["resolve".to_string(), "--accept".to_string(), strategy.to_string()];
    for file in files {
        args.push(file.clone());
    }
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    execute_svn(&args_refs, Some(path)).await
}

pub async fn cleanup(path: &str) -> Result<String, SvnError> {
    let args = vec!["cleanup"];
    execute_svn(&args, Some(path)).await
}

pub async fn switch_cmd(path: &str, url: &str) -> Result<String, SvnError> {
    let args = vec!["switch", url];
    execute_svn(&args, Some(path)).await
}

pub async fn merge(path: &str, source: &str, rev_start: u64, rev_end: u64) -> Result<String, SvnError> {
    let args = vec![
        "merge".to_string(),
        "-r".to_string(),
        format!("{}:{}", rev_start, rev_end),
        source.to_string(),
    ];
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    execute_svn(&args_refs, Some(path)).await
}
