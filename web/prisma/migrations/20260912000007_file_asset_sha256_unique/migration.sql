-- CreateIndex
CREATE UNIQUE INDEX "FileAsset_workspaceId_sha256_key" ON "file_assets"("workspace_id", "sha256");