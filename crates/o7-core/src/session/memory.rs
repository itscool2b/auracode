//! User-facing project memory operations. All reads and changes use the profile writer.
use super::*;
use crate::chatstore::memory::{Command, Reply};
use o7_protocol::memory::*;
fn failed(error: impl std::fmt::Display) -> SessionError {
    SessionError::OptionInvalid(error.to_string())
}
impl SessionManager {
    pub async fn read_project_memory(
        &self,
        project_id: &str,
    ) -> Result<ProjectMemory, SessionError> {
        match self
            .deps()
            .store
            .memory(Command::Read(project_id.into()))
            .await
            .map_err(failed)?
        {
            Reply::Memory(v) => Ok(v),
            _ => Err(failed("Invalid memory reply.")),
        }
    }
    pub async fn save_project_memory(
        &self,
        input: SaveProjectMemory,
    ) -> Result<ProjectMemory, SessionError> {
        match self
            .deps()
            .store
            .memory(Command::Save(input))
            .await
            .map_err(failed)?
        {
            Reply::Memory(v) => Ok(v),
            _ => Err(failed("Invalid memory reply.")),
        }
    }
    pub async fn propose_project_memory(
        &self,
        input: ProposeProjectMemory,
    ) -> Result<MemoryProposal, SessionError> {
        match self
            .deps()
            .store
            .memory(Command::Propose(input))
            .await
            .map_err(failed)?
        {
            Reply::Proposal(v) => Ok(v),
            _ => Err(failed("Invalid memory reply.")),
        }
    }
    pub async fn accept_memory_proposal(
        &self,
        input: AcceptMemoryProposal,
    ) -> Result<ProjectMemory, SessionError> {
        match self
            .deps()
            .store
            .memory(Command::Accept(input))
            .await
            .map_err(failed)?
        {
            Reply::Memory(v) => Ok(v),
            _ => Err(failed("Invalid memory reply.")),
        }
    }
    pub async fn reject_memory_proposal(
        &self,
        project_id: &str,
        proposal_id: &str,
    ) -> Result<Vec<MemoryProposal>, SessionError> {
        match self
            .deps()
            .store
            .memory(Command::Reject {
                project_id: project_id.into(),
                proposal_id: proposal_id.into(),
            })
            .await
            .map_err(failed)?
        {
            Reply::Proposals(v) => Ok(v),
            _ => Err(failed("Invalid memory reply.")),
        }
    }
    pub async fn project_memory_history(
        &self,
        project_id: &str,
    ) -> Result<Vec<MemoryRevision>, SessionError> {
        match self
            .deps()
            .store
            .memory(Command::History(project_id.into()))
            .await
            .map_err(failed)?
        {
            Reply::History(v) => Ok(v),
            _ => Err(failed("Invalid memory reply.")),
        }
    }
    pub async fn project_memory_proposals(
        &self,
        project_id: &str,
    ) -> Result<Vec<MemoryProposal>, SessionError> {
        match self
            .deps()
            .store
            .memory(Command::Proposals(project_id.into()))
            .await
            .map_err(failed)?
        {
            Reply::Proposals(v) => Ok(v),
            _ => Err(failed("Invalid memory reply.")),
        }
    }
    pub async fn export_project_memory(
        &self,
        project_id: &str,
    ) -> Result<ProjectMemoryBundle, SessionError> {
        match self
            .deps()
            .store
            .memory(Command::Export(project_id.into()))
            .await
            .map_err(failed)?
        {
            Reply::Bundle(v) => Ok(v),
            _ => Err(failed("Invalid memory reply.")),
        }
    }
    pub async fn import_project_memory(
        &self,
        input: ImportProjectMemory,
    ) -> Result<ProjectMemory, SessionError> {
        match self
            .deps()
            .store
            .memory(Command::Import(input))
            .await
            .map_err(failed)?
        {
            Reply::Memory(v) => Ok(v),
            _ => Err(failed("Invalid memory reply.")),
        }
    }
}
