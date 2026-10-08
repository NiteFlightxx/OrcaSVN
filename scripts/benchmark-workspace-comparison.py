#!/usr/bin/env python3
"""Compare stable and cached SVN workspace loading using isolated Rust harnesses.

Requires git, cargo, svn and svnadmin. Creates only temporary working copies;
source revisions and the repository working tree are never modified.
"""
import argparse
import json
from pathlib import Path
import platform
import subprocess
import tempfile

STRUCTS = r"""
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SvnStatus {
    pub path: String,
    pub status: String,
    pub status_code: String,
    pub prop_status: String,
    pub locked: bool,
    pub history: bool,
    pub switched: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SvnLogEntry {
    pub revision: u64,
    pub author: String,
    pub date: String,
    pub message: String,
    pub changed_paths: Vec<SvnLogPath>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SvnLogPath {
    pub path: String,
    pub action: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SvnInfo {
    pub path: String,
    pub url: String,
    pub repository_root: String,
    pub revision: u64,
    pub node_kind: String,
    pub schedule: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SvnAuthUser {
    pub username: String,
    pub realm: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffResult {
    pub path: String,
    pub diff: String,
    pub old_revision: u64,
    pub new_revision: u64,
}


"""
RUNNER = r"""
async fn get_status(path:&str,directory:Option<std::path::PathBuf>)->Vec<SvnStatus> { {{STATUS_CALL}} }
fn main() {
 let path=std::env::args().nth(1).unwrap();
 let rt=tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
 let cache=std::env::temp_dir().join(format!("orcasvn-compare-cache-{}",std::process::id()));
 rt.block_on(async {
  let expected=svn::status(&path).await.unwrap();
  for mode in ["cold","memory","reopen","status-only"] {
   let mut times=Vec::new();
   for iteration in 0..18 {
    if mode=="cold" || mode=="reopen" { {{FORGET_CALL}} }
    let directory=if mode=="cold" { Some(cache.join(format!("cold-{iteration}"))) } else { Some(cache.clone()) };
    let start=std::time::Instant::now();
    let got=if mode=="status-only" {
      get_status(&path,directory).await
    } else {
      let revpath=path.clone();
      let revision=tokio::spawn(async move { svn::local_revision(&revpath).await.unwrap() });
      let infopath=path.clone();
      let metadata=if mode=="cold" { Some(tokio::spawn(async move { svn::info(&infopath).await.unwrap() })) } else { None };
      let statuses=get_status(&path,directory).await;
      revision.await.unwrap(); if let Some(metadata)=metadata { metadata.await.unwrap(); } statuses
    };
    let elapsed=start.elapsed().as_secs_f64()*1000.;
    assert_eq!(format!("{got:?}"),format!("{expected:?}"));
    if iteration>=3 { times.push(elapsed); }
   }
   times.sort_by(f64::total_cmp);
   println!("{{\"mode\":\"{}\",\"median_ms\":{:.4},\"p95_ms\":{:.4},\"samples\":15}}",mode,times[7],times[14]);
  }
  {{FORGET_CALL}}
 });
 let _=std::fs::remove_dir_all(cache);
}
"""
FORGET = r"""
pub(super) async fn benchmark_forget(path: &str) {
    let root = std::fs::canonicalize(path).unwrap();
    let workspace = get_workspace(&root).unwrap();
    let mut workspace = workspace.lock().await;
    if let Some(save) = workspace.pending_save.take() { save.await.unwrap(); }
    WORKSPACES.get().unwrap().lock().unwrap().retain(|(path, _)| path != &root);
}
"""
MANIFEST = """[package]
name = "orcasvn-workspace-comparison"
version = "0.0.0"
edition = "2021"
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["rt", "time", "process", "sync"] }
thiserror = "2"
quick-xml = "0.37"
tracing = "0.1"
chrono = "0.4"
[[bin]]
name = "stable"
path = "stable/main.rs"
[[bin]]
name = "current"
path = "current/main.rs"
"""


def run(args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', default='v0.6.2')
    parser.add_argument('--candidate', default='v0.6.3')
    parser.add_argument('--files', nargs='+', type=int, default=[1000, 10000])
    parser.add_argument('--output', type=Path)
    options = parser.parse_args()
    if any(count <= 0 for count in options.files):
        parser.error('--files must contain positive file counts')
    repo = Path(run(['git', 'rev-parse', '--show-toplevel']))
    revisions = {name: run(['git', 'rev-parse', ref], cwd=repo)
                 for name, ref in [('stable', options.baseline), ('current', options.candidate)]}
    measurements = []
    with tempfile.TemporaryDirectory(prefix='orcasvn-workspace-comparison-') as temporary:
        root = Path(temporary)
        root.joinpath('Cargo.toml').write_text(MANIFEST)
        root.joinpath('Cargo.lock').write_text(repo.joinpath('docs/benchmarks/workspace-comparison.Cargo.lock').read_text())
        for variant, revision in revisions.items():
            source = root / variant / 'svn'
            source.mkdir(parents=True)
            files = run(['git', 'ls-tree', '--name-only', revision, 'src-tauri/src/svn/'], cwd=repo)
            for filename in files.splitlines():
                source.joinpath(Path(filename).name).write_text(run(['git', 'show', f'{revision}:{filename}'], cwd=repo) + '\n')
            if variant == 'current':
                with source.joinpath('status_cache.rs').open('a') as file:
                    file.write(FORGET)
                with source.joinpath('mod.rs').open('a') as file:
                    file.write('\npub async fn benchmark_forget(path: &str) { status_cache::benchmark_forget(path).await; }\n')
            status = 'svn::status(path).await.unwrap()' if variant == 'stable' else 'svn::cached_status(path,false,directory).await.unwrap()'
            forget = '' if variant == 'stable' else 'svn::benchmark_forget(&path).await;'
            code = RUNNER.replace('{{STATUS_CALL}}', status).replace('{{FORGET_CALL}}', forget)
            root.joinpath(variant, 'main.rs').write_text('#![allow(dead_code,unused_imports,unused_variables)]\nuse serde::{Serialize,Deserialize};\nmod svn;\n' + STRUCTS + code)
        subprocess.run(['cargo', 'build', '--release', '--locked', '--manifest-path', str(root / 'Cargo.toml')], check=True)
        for count in options.files:
            fixture = root / f'fixture-{count}'
            fixture.mkdir()
            run(['svnadmin', 'create', str(fixture / 'repo')])
            wc = fixture / 'wc'
            run(['svn', 'checkout', (fixture / 'repo').as_uri(), str(wc)])
            for index in range(count):
                directory = wc / 'src' / f'group-{index // 100:03}'
                directory.mkdir(parents=True, exist_ok=True)
                directory.joinpath(f'file-{index % 100:03}.txt').write_text('benchmark\n')
            run(['svn', 'add', str(wc / 'src')])
            run(['svn', 'commit', str(wc), '-m', f'{count} benchmark files'])
            for variant in revisions:
                output = run([str(root / 'target' / 'release' / variant), str(wc)])
                for line in output.splitlines():
                    measurements.append(dict(files=count, variant=variant, **json.loads(line)))
    result = dict(platform=platform.platform(), build='release', svn_version=run(['svn', '--version', '--quiet']),
                  rust_version=run(['rustc', '--version']), baseline=revisions['stable'], candidate=revisions['current'],
                  warmup_runs=3, samples_per_scenario=15, measurements=measurements)
    output = json.dumps(result, indent=2) + '\n'
    if options.output:
        options.output.write_text(output)
    else:
        print(output, end='')


if __name__ == '__main__':
    main()
