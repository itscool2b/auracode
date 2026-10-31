//! Byte-bounded Git input avoids a process per small group of checkpoint files.

use std::collections::BTreeMap;
use std::path::Path;

use super::scan::{SavedFile, Scan};
use super::{CheckpointError, Operation, Result, git, scan};

struct Batch {
    input: Vec<u8>,
    records: usize,
}

fn batches(records: impl IntoIterator<Item = Result<Vec<u8>>>) -> Result<Vec<Batch>> {
    let mut batches = Vec::new();
    let mut batch = Batch {
        input: Vec::new(),
        records: 0,
    };
    for record in records {
        let record = record?;
        if record.len() > git::INPUT_LIMIT {
            return Err(CheckpointError::Message(
                "A checkpoint Git input record exceeded its safety limit.".into(),
            ));
        }
        if batch.input.len() + record.len() > git::INPUT_LIMIT {
            batches.push(batch);
            batch = Batch {
                input: Vec::new(),
                records: 0,
            };
        }
        batch.input.extend(record);
        batch.records += 1;
    }
    if batch.records > 0 {
        batches.push(batch);
    }
    Ok(batches)
}

fn hash_ids(output: &[u8], expected: usize) -> Result<Vec<String>> {
    let Some(output) = output.strip_suffix(b"\n") else {
        return Err(CheckpointError::Message(
            "Git returned incomplete checkpoint object IDs.".into(),
        ));
    };
    let ids = output
        .split(|byte| *byte == b'\n')
        .map(git::oid)
        .collect::<Result<Vec<_>>>()?;
    if ids.len() != expected {
        return Err(CheckpointError::Message(
            "Git did not save every checkpoint file.".into(),
        ));
    }
    Ok(ids)
}

fn index_record(path: &str, file: &SavedFile) -> Result<Vec<u8>> {
    scan::validate(path)?;
    git::oid(file.oid.as_bytes())?;
    if !matches!(file.fingerprint.mode, 0o100644 | 0o100755) {
        return Err(CheckpointError::Message(
            "The checkpoint contains an unsupported file mode.".into(),
        ));
    }
    Ok(format!("{:o} {}\t{path}\0", file.fingerprint.mode, file.oid).into_bytes())
}

/// `retained` deliberately also supports old excluded files for `diff_stat`. Captures pass only
/// verified reusable files; callers decide which old entries belong in the new tree.
pub(super) async fn write_tree(
    operation: &Operation,
    root: &Path,
    scanned: &Scan,
    retained: Option<&BTreeMap<String, SavedFile>>,
) -> Result<(BTreeMap<String, SavedFile>, String)> {
    operation.context.check()?;
    let mut files = retained.cloned().unwrap_or_default();
    if let Some((_, first_copy)) = scanned.copies.first() {
        let directory = first_copy.parent().ok_or_else(|| {
            CheckpointError::Message("Checkpoint scratch directory was lost.".into())
        })?;
        if !directory.starts_with(operation.scratch.path()) {
            return Err(CheckpointError::Message(
                "Checkpoint scratch files escaped the operation directory.".into(),
            ));
        }
        let inputs = batches(scanned.copies.iter().map(|(_, copy)| {
            let name = copy.file_name().and_then(|name| name.to_str());
            match name {
                Some(name)
                    if copy.parent() == Some(directory)
                        && !name.is_empty()
                        && name.bytes().all(|byte| byte.is_ascii_digit()) =>
                {
                    Ok(format!("{name}\n").into_bytes())
                }
                _ => Err(CheckpointError::Message(
                    "Checkpoint scratch files have an invalid identity.".into(),
                )),
            }
        }))?;
        let mut offset = 0;
        for batch in inputs {
            operation.context.check()?;
            let output = operation
                .git
                .run_input_at(
                    &operation.repo,
                    root,
                    &operation.index,
                    directory,
                    vec![
                        "hash-object".into(),
                        "--no-filters".into(),
                        "-w".into(),
                        "--stdin-paths".into(),
                    ],
                    batch.input,
                    batch.records * 42,
                )
                .await?;
            let ids = hash_ids(&output, batch.records)?;
            for ((path, _), oid) in scanned.copies[offset..offset + batch.records]
                .iter()
                .zip(ids)
            {
                let fingerprint = scanned.files.get(path).ok_or_else(|| {
                    CheckpointError::Message("Checkpoint file metadata was lost.".into())
                })?;
                files.insert(
                    path.clone(),
                    SavedFile {
                        fingerprint: fingerprint.clone(),
                        oid,
                    },
                );
            }
            offset += batch.records;
        }
    }
    // An empty private index naturally omits deleted files. Retained files and captured files
    // are inserted together, with NUL records preserving spaces, Unicode and literal pathspecs.
    for batch in batches(files.iter().map(|(path, file)| index_record(path, file)))? {
        operation.context.check()?;
        operation
            .git
            .run_input(
                &operation.repo,
                root,
                &operation.index,
                vec!["update-index".into(), "-z".into(), "--index-info".into()],
                batch.input,
                4096,
            )
            .await?;
    }
    operation.context.check()?;
    let tree = git::oid(
        &operation
            .git
            .run(
                &operation.repo,
                root,
                &operation.index,
                vec!["write-tree".into()],
                128,
            )
            .await?,
    )?;
    Ok((files, tree))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checkpoints::Checkpoints;
    use crate::checkpoints::coordination;
    use crate::paths::DataRoot;
    use crate::profile::Profiles;
    use aura_process::{EnvResolver, EnvSource, LeftoverRegistry, ResolvedEnv, process_env};

    #[test]
    fn input_batches_respect_the_byte_limit_without_splitting_records() {
        let first = vec![b'a'; git::INPUT_LIMIT - 5];
        let unicode = "é\t\0".as_bytes().to_vec();
        let last = vec![b'z'; 2];
        let result = batches([Ok(first.clone()), Ok(unicode.clone()), Ok(last.clone())]).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].records, 2);
        assert_eq!(result[1].records, 1);
        assert_eq!(result[0].input, [first, unicode].concat());
        assert_eq!(result[1].input, last);
        assert!(
            result
                .iter()
                .all(|batch| batch.input.len() <= git::INPUT_LIMIT)
        );
        assert!(batches([Ok(vec![0; git::INPUT_LIMIT + 1])]).is_err());
        assert!(batches(std::iter::empty()).unwrap().is_empty());
    }

    #[test]
    fn hash_output_requires_every_complete_valid_object_id() {
        let id = "0123456789abcdef0123456789abcdef01234567";
        assert_eq!(
            hash_ids(format!("{id}\n{id}\r\n").as_bytes(), 2).unwrap(),
            [id, id]
        );
        assert!(hash_ids(format!("{id}\n").as_bytes(), 2).is_err());
        assert!(hash_ids(format!("{id}\n{id}\n").as_bytes(), 1).is_err());
        assert!(hash_ids(id.as_bytes(), 1).is_err());
        assert!(hash_ids(format!("{id}\n\n").as_bytes(), 1).is_err());
        assert!(hash_ids(b"invalid\n", 1).is_err());
    }

    #[tokio::test]
    async fn batched_writer_preserves_retained_bytes_and_uses_three_helpers_for_many_files() {
        let temp = tempfile::tempdir().unwrap();
        let profile = Profiles::new(DataRoot::at(temp.path().join("data")))
            .open_active()
            .unwrap();
        let work = temp.path().join("work with spaces");
        std::fs::create_dir(&work).unwrap();
        let work = std::fs::canonicalize(work).unwrap();
        let env = EnvResolver::fixed(ResolvedEnv {
            vars: process_env(),
            source: EnvSource::Fallback {
                reason: "batched checkpoint fixture".into(),
            },
            warnings: vec![],
            resolved_at_ms: 0,
        });
        let service = Checkpoints::new(&profile, env, LeftoverRegistry::disabled());
        let folder = crate::ids::new_id();
        let owner = coordination::acquire(&service.root, &folder, &work)
            .await
            .unwrap();
        let operation = service
            .operation(&folder, &work, true, owner.context())
            .await
            .unwrap();
        let copies = operation.scratch.path().join("original copies");
        std::fs::create_dir(&copies).unwrap();
        let original = b"original\r\n\0\xff";
        std::fs::write(work.join("retained.txt"), original).unwrap();
        let scanned = scan::collect(&work, &["retained.txt".into()], Some(&copies)).unwrap();
        let (retained, _) = write_tree(&operation, &work, &scanned, None).await.unwrap();

        let operation = service
            .operation(&folder, &work, false, owner.context())
            .await
            .unwrap();
        let copies = operation.scratch.path().join("fresh copies");
        std::fs::create_dir(&copies).unwrap();
        let paths: Vec<_> = (0..130).map(|i| format!("file {i} é.txt")).collect();
        for path in &paths {
            std::fs::write(work.join(path), path.as_bytes()).unwrap();
        }
        let scanned = scan::collect(&work, &paths, Some(&copies)).unwrap();
        let before = operation.git.helper_count();
        let (files, tree) = write_tree(&operation, &work, &scanned, Some(&retained))
            .await
            .unwrap();
        assert_eq!(operation.git.helper_count() - before, 3);
        assert_eq!(files.len(), 131);
        let listed = operation
            .git
            .run(
                &operation.repo,
                &work,
                &operation.index,
                vec![
                    "ls-tree".into(),
                    "-rz".into(),
                    "--name-only".into(),
                    tree.into(),
                ],
                16 * 1024,
            )
            .await
            .unwrap();
        assert_eq!(listed.iter().filter(|byte| **byte == 0).count(), 131);
        let restored = service
            .blob(&operation, &work, files.get("retained.txt").unwrap())
            .await
            .unwrap();
        assert_eq!(restored, original);

        let result = operation
            .git
            .run_input(
                &operation.repo,
                &work,
                &operation.index,
                vec!["hash-object".into(), "--stdin".into()],
                vec![0; git::INPUT_LIMIT + 1],
                128,
            )
            .await;
        assert!(result.is_err());
        let result = operation
            .git
            .run_input(
                &operation.repo,
                &work,
                &operation.index,
                vec!["hash-object".into(), "--stdin".into()],
                b"contents".to_vec(),
                1,
            )
            .await;
        assert!(result.is_err());
    }
}
