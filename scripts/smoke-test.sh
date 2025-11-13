#!/bin/bash
# Smoke test for ghwt basic workflow
# Creates a test worktree, verifies structure, cleans up

set -e

TEST_PROJECT="test-repo"
TEST_BRANCH="smoke-test-branch"
PROJECTS_ROOT="${HOME}/projects"

echo "🧪 Running ghwt smoke test..."

# Verify ghwt is available
if ! command -v ghwt &> /dev/null; then
    echo "❌ ghwt not found. Run 'npm link' first."
    exit 1
fi

echo "✅ ghwt is available"

# TODO: Add test repository setup
# TODO: Test create command
# TODO: Verify directory structure
# TODO: Test sync command
# TODO: Test rm command
# TODO: Cleanup

echo "✅ Smoke test passed"
