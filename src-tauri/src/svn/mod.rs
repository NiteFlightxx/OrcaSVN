mod commit_selection;
mod executor;
#[cfg(test)]
pub(crate) use executor::{after_test_commit, capture_commands, take_commands};
mod history_presence;
mod operations;
mod parser;
mod status_cache;
mod status_patch;
mod status_snapshot;
mod status_usn;
#[cfg(any(windows, test))]
mod status_watch;

pub use commit_selection::{commit_selection, CommitOutcome};
pub use executor::configure_svn_executable;
pub(crate) use executor::copy_repository;
pub(crate) use executor::execute_svn;
pub use history_presence::{history_base_fingerprint, history_presence, HistoryPresence};
pub use operations::*;
pub(crate) use parser::{parse_info_revisions_xml, parse_info_xml, parse_status_xml};
pub use status_cache::cached_status;
pub(crate) use status_cache::invalidate_status;
pub use status_patch::StatusPatch;
