# ModelScope Handoff Evidence Recovery

This directory preserves non-sensitive evidence for the proposed source-only package. The package ZIP itself is not stored in this evidence directory; its expected SHA-256 is recorded in `PACKAGE-SHA256SUMS` and `MANIFEST.json`.

## Source identity

- Repository: `https://github.com/Nanmuxxx/BlockCraft-AI`
- Source commit: `4a95cae50f772cd242d932cdbd93366381d1df74`
- Source tree: `b19a52f8cdc82aa137b57a1396f996b6becfda3f`
- Package: 147 source files; 405216 bytes; SHA-256 `0aa88413cbe9d5611a963f1b8c7ecc87405b2b5586c9ea92a156c30b96b16812`
- The deployment preparation guide is `../docker-modelscope-initial-deployment-20261020.md`.

## Restore this evidence

From a clean clone, check out the documentation branch after it is published:

```sh
git clone https://github.com/Nanmuxxx/BlockCraft-AI.git
cd BlockCraft-AI
git fetch origin docs/docker-deployment-handoff-20261019
git switch --detach FETCH_HEAD
```

The evidence is under `docs/modelscope-handoff-20261020/`; the deployment guide is under `docs/`. To verify the package hash when the ZIP is available locally:

```sh
shasum -a 256 /path/to/BlockCraftAI-main-4a95cae-source-only.zip
```

Compare the output to `PACKAGE-SHA256SUMS`. To verify the source files from the package after extraction, run the checks from the extracted package root:

```sh
shasum -a 256 -c /path/to/SOURCE-SHA256SUMS
```

The source-only ZIP is intentionally not reconstructed from the manifest here because archive metadata/compression can change the ZIP hash. The manifest and per-file checksums identify its contents. These steps only restore/verify documentation and files; they do not upload, push to ModelScope, build, deploy, configure secrets, or call a model.
