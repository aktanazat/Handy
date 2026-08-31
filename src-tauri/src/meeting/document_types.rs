use super::types::MeetingOperationId;
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize, Type)]
#[serde(transparent)]
pub struct DocumentId(pub Uuid);

impl DocumentId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub const fn uuid(self) -> Uuid {
        self.0
    }
}

impl Default for DocumentId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct DocumentSummary {
    pub id: DocumentId,
    pub title: String,
    pub source_name: String,
    pub media_type: String,
    pub created_at_utc_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct Document {
    pub summary: DocumentSummary,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct DocumentIngestRequest {
    pub path: String,
    pub operation_id: MeetingOperationId,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct DocumentDeleteRequest {
    pub document_id: DocumentId,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct DocumentListResult {
    pub schema_version: u32,
    pub revision: u64,
    pub entries: Vec<Document>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
pub struct DocumentMutationResult {
    pub schema_version: u32,
    pub revision: u64,
    pub document: Option<Document>,
    pub removed: bool,
}
