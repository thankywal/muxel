/**
 * The workflow an operator pastes to turn on automatic updates.
 *
 * Held here as well as in .github/workflows/update.yml because the setup page
 * builds a GitHub link that pre-fills a new file with this exact content, and
 * the Worker cannot read files at runtime. A test keeps the two identical, the
 * same way the VERSION file is kept honest.
 *
 * It must stay a stub. The Cloudflare GitHub App cannot create workflow files,
 * so this is pasted by a person exactly once and can never be updated by the
 * sync, which deliberately leaves .github/ alone. All logic that could ever
 * need changing belongs in scripts/update.sh.
 */
export const UPDATE_STUB = "name: Update from upstream\n\n# Keeps a deployed copy of Muxel current.\n#\n# This file is pasted into the operator's repository by hand, once, because\n# the Cloudflare GitHub App cannot create workflow files when it makes the\n# copy. It is deliberately a stub: the update logic lives in scripts/update.sh,\n# which arrives with every sync, is committed and reviewable in this\n# repository's own history, and can be fixed upstream without anyone having to\n# paste this file again.\n#\n# One repository setting is required before this can push:\n# Settings -> Actions -> General -> Workflow permissions -> Read and write.\n\non:\n  schedule:\n    - cron: \"17 3 * * *\"\n  workflow_dispatch:\n\npermissions:\n  contents: write\n\nconcurrency:\n  group: update-from-upstream\n  cancel-in-progress: false\n\njobs:\n  update:\n    name: Pull upstream changes\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    if: github.repository != 'thankywal/muxel'\n\n    steps:\n      - uses: actions/checkout@v4\n\n      - name: Apply upstream\n        env:\n          GH_TOKEN: ${{ github.token }}\n        run: |\n          # A copy made before the script existed fetches it once to\n          # bootstrap; every later run uses the committed one. It runs from\n          # /tmp because the sync replaces the tree it was read from.\n          if [ ! -f scripts/update.sh ]; then\n            mkdir -p scripts\n            curl -fsSL --retry 3 \\\n              https://raw.githubusercontent.com/thankywal/muxel/main/scripts/update.sh \\\n              -o scripts/update.sh\n          fi\n          cp scripts/update.sh /tmp/muxel-update.sh\n          bash /tmp/muxel-update.sh\n";
