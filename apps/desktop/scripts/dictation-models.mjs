/**
 * The speech models o7 bundles for dictation (docs/local-dictation.md). Each is pinned to a
 * Hugging Face revision, a size and a SHA-256, fetched into src-tauri/resources/dictation before a
 * release bundle, and verified there. The files are model weights only: nothing runs from them.
 *
 *   node scripts/dictation-models.mjs          fetch what is missing or wrong, then verify
 *   node scripts/dictation-models.mjs --check  verify only; fails when a file is missing or wrong
 *
 * Debug builds and tests run without them: the resource folder keeps a README so Tauri's resource
 * glob always matches, and dictation then says the models are missing.
 */
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const MODEL_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src-tauri/resources/dictation",
);

/** Kept in step with `dictation::model::BUNDLED` in the Rust crate (a test compares them). */
export const MODELS = [
  {
    // English speech to text with punctuation and capitals, CC-BY-4.0 (NVIDIA; GGUF conversion by
    // handy-computer for transcribe.cpp). Q6_K: 2.44% WER on LibriSpeech test-clean, F32 2.43%.
    file: "parakeet-tdt_ctc-110m-Q6_K.gguf",
    repo: "handy-computer/parakeet-tdt_ctc-110m-gguf",
    revision: "1c3f0d5378fdd358905cc410a93ed9e64f52d170",
    size: 112311264,
    sha256: "c20520c245adf82e5166005f599cb3b95e7cf5192117e845be4bbcd39226d483",
  },
  {
    // Voice activity detection, MIT (Silero; GGUF conversion by handy-computer).
    file: "silero-vad-v6.2-F32.gguf",
    repo: "handy-computer/silero-vad-v6.2-gguf",
    revision: "a9b2d61c20ae4ddf3644edb34969e8185a485448",
    size: 1241056,
    sha256: "0d871a800c420fdd5d1b17a3aea4296d1c39608f0ff4a9295eb76457eb1c88e6",
  },
];

async function digest(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/** Whether `path` holds exactly the pinned file. */
export async function verified(model, directory = MODEL_DIR) {
  const path = join(directory, model.file);
  if (!existsSync(path) || statSync(path).size !== model.size) return false;
  return (await digest(path)) === model.sha256;
}

async function fetchModel(model, directory) {
  const url = `https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.file}`;
  const partial = join(directory, `${model.file}.partial`);
  rmSync(partial, { force: true });
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`${model.file}: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  const size = statSync(partial).size;
  const sha256 = await digest(partial);
  if (size !== model.size || sha256 !== model.sha256) {
    rmSync(partial, { force: true });
    throw new Error(`${model.file}: got ${size} bytes, sha256 ${sha256}; expected the pinned file`);
  }
  renameSync(partial, join(directory, model.file));
}

export async function ensureModels({ check = false, directory = MODEL_DIR } = {}) {
  mkdirSync(directory, { recursive: true });
  for (const model of MODELS) {
    if (await verified(model, directory)) continue;
    if (check)
      throw new Error(
        `${model.file} is missing or not the pinned file. Run node scripts/dictation-models.mjs.`,
      );
    process.stdout.write(`Fetching ${model.file} (${(model.size / 1e6).toFixed(1)} MB)\n`);
    await fetchModel(model, directory);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureModels({ check: process.argv.includes("--check") }).then(
    () => process.stdout.write("Dictation models verified.\n"),
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
