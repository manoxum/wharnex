# Getting Started

See the root README for quick start. Start in `manual` planner mode first, verify the Docker runner, then configure the OpenAI adapter.

## Optional remote context transport

Without configuration, consumer ChatGPT keeps using the native Wharness file
upload flow. Remote mode publishes one temporary input ZIP and sends ChatGPT a
short HTTPS bootstrap URL instead.

### Configure a provider-instance pool

Configure the pool in **Configurações → Storage remoto**. Choose Google Drive,
Dropbox, OneDrive, Box or pCloud and select **Ligar** to authenticate in the
browser. S3-compatible storage, WebDAV and Nextcloud use guided forms in the
same screen. No terminal or JSON editing is required for normal setup.

For advanced or automated installations, create `remote-storage.json` beside
the Wharness session state file. With the canonical
repository lifecycle this is `.harness/state/remote-storage.json`. Changes made
through the UI become active after restarting Wharness.
Use `HARNESS_REMOTE_STORAGE_CONFIG_FILE` to select another path. The file follows
`schemas/remote-storage-config.schema.json` and may contain several accounts of
the same provider.

Lower priority numbers are attempted first. Every limit belongs only to that
instance/account; zero or omission means unlimited.

```json
{
  "version": 1,
  "instances": [
    {
      "id": "drive-primary",
      "provider": "rclone",
      "priority": 10,
      "rclone_remote": "company-drive",
      "rclone_prefix": "wharness-inputs",
      "limits": {
        "max_requests": 100,
        "window_seconds": 86400,
        "max_files_per_input": 64,
        "max_file_bytes": 134217728,
        "max_input_bytes": 268435456,
        "max_stored_objects": 500,
        "max_storage_bytes": 10737418240
      }
    },
    {
      "id": "drive-secondary",
      "provider": "rclone",
      "priority": 20,
      "rclone_remote": "personal-drive",
      "rclone_prefix": "wharness-inputs",
      "limits": {
        "max_requests": 50,
        "window_seconds": 86400,
        "max_storage_bytes": 5368709120
      }
    },
    {
      "id": "private-webdav",
      "provider": "webdav",
      "priority": 30,
      "upload_url": "https://storage.example.com/private/wharness-inputs/",
      "public_url": "https://files.example.com/wharness-inputs/",
      "authorization_env": "WHARNESS_WEBDAV_AUTHORIZATION",
      "limits": {
        "max_requests": 1000,
        "window_seconds": 86400
      }
    }
  ]
}
```

The runtime reports per-instance limits and current usage in
`GET /api/config` under `remote_input.instances`.

### rclone implementation

Wharness uses rclone behind its provider catalogue. The selected provider must
support `rclone link`, or you must expose the configured prefix through a public
HTTPS base URL.

Set `public_url` on an rclone instance when its provider does not implement
`rclone link`.

### HTTP or WebDAV-compatible PUT

This adapter works with hosted or self-hosted object gateways that accept `PUT`
and `DELETE` at `<upload-base>/<object-name>` and expose the same objects at a
public HTTPS prefix.

Set the configured `authorization_env` variable in the Wharness process, for
example `export WHARNESS_WEBDAV_AUTHORIZATION='Bearer ...'`.

The authorization value is resolved from the named environment variable,
consumed only by the backend, and never returned
by `/api/config`, sent to the renderer, or written into a context archive. Put
secrets in the process environment or service secret manager, not in
`whaness.yml`. Wharness tracks its publications locally and deletes them after
seven days. The previous single-provider `HARNESS_REMOTE_STORAGE_*` variables
remain accepted as a legacy one-instance configuration when no JSON file exists.
