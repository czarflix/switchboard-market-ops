import assert from "node:assert/strict";
import test from "node:test";

import {
  ensurePreviewAccess,
  hasPreviewAccess,
  readPreviewAccessConfig,
  readPreviewAccessPresentationConfig,
} from "./preview-access-core.ts";

test("preview access accepts only users with the preview metadata flag", async () => {
  const authorizedUser = {
    id: "preview-user",
    app_metadata: { preview_access: true },
  };
  const unauthorizedUser = {
    id: "standard-user",
    app_metadata: {},
  };

  assert.equal(hasPreviewAccess(authorizedUser), true);
  assert.equal(hasPreviewAccess(unauthorizedUser), false);
  assert.equal(await ensurePreviewAccess(authorizedUser), authorizedUser);
  assert.equal(await ensurePreviewAccess(unauthorizedUser), null);
  assert.equal(await ensurePreviewAccess(null), null);
});

test("preview signup follows the access-code and explicit-disable rules", () => {
  assert.deepEqual(
    readPreviewAccessConfig({ PREVIEW_ACCESS_CODE: "  sample-code  " }),
    {
      previewAccessCode: "sample-code",
      previewSignupEnabled: true,
    },
  );
  assert.deepEqual(
    readPreviewAccessConfig({
      PREVIEW_ACCESS_CODE: "sample-code",
      PREVIEW_SIGNUP_ENABLED: "false",
    }),
    {
      previewAccessCode: "sample-code",
      previewSignupEnabled: false,
    },
  );
  assert.deepEqual(readPreviewAccessConfig({}), {
    previewAccessCode: undefined,
    previewSignupEnabled: false,
  });
});

test("preview repository messaging follows the configured publication time", () => {
  const source = {
    PREVIEW_ACCESS_REPO_URL: "https://github.com/example/project",
    PREVIEW_ACCESS_PUBLISH_AT: "2026-03-26T17:00:00.000Z",
  };

  const beforePublication = readPreviewAccessPresentationConfig(
    source,
    new Date("2026-03-26T16:59:59.000Z"),
  );
  const afterPublication = readPreviewAccessPresentationConfig(
    source,
    new Date("2026-03-26T17:00:00.000Z"),
  );

  assert.equal(beforePublication.previewAccessPublished, false);
  assert.match(beforePublication.previewAccessRepoMessage, /managed privately until/);
  assert.equal(afterPublication.previewAccessPublished, true);
  assert.equal(
    afterPublication.previewAccessRepoMessage,
    "Preview access is configured through private deployment settings.",
  );
});
