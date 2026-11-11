use serde::Serialize;

/// Exact paths and explicitly recursive subtrees refreshed after a local write.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusPatch {
    pub workspace: String,
    pub expected_url: String,
    pub paths: Vec<String>,
    pub subtrees: Vec<String>,
    pub entries: Vec<crate::SvnStatus>,
}
