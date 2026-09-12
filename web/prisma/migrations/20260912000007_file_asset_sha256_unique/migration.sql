-- CreateIndex
CREATE UNIQUE INDEX "FileAsset_workspaceId_sha256_key" ON "FileAsset"("workspaceId", "sha256");