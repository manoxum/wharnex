export type PostgresConnectionInput = { host: string; port: number; database: string; user: string; password: string; sslmode: 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full' }
export type PostgresColumn = { name: string; data_type: string; nullable: boolean }
export type PostgresTable = { schema: string; name: string; type: string; columns: PostgresColumn[] }
export type PostgresCatalog = { database: string; version: string; tables: PostgresTable[] }
export type PostgresQueryResult = { columns: string[]; rows: unknown[][]; row_count: number; truncated: boolean; duration_ms: number }

export type ArtifactPresentationItem = { path: string; preview_path?: string; label?: string; description?: string; alt?: string; size: number; content_type: string; kind: 'image' | 'audio' | 'video' | 'pdf' | 'html' | 'office' | 'markdown' | 'text' | 'binary' }
export type ArtifactPresentationGallery = { id: string; title?: string; description?: string; layout: 'auto' | 'grid' | 'masonry' | 'strip'; sizing: 'uniform' | 'adaptive'; items: ArtifactPresentationItem[] }
export type ArtifactPresentation = { protocol: 'harness.artifact-presentation/v1'; fallback: boolean; warning?: string; galleries: ArtifactPresentationGallery[] }
export type ArtifactSettings = { retention_days: number; bundle_window_limit: number; attachment_count_limit: number; request_bundle_total_bytes: number; request_bundle_part_bytes: number; request_bundle_part_limit: number }
export type LanguageCode = 'pt' | 'en' | 'fr'
export type LanguageSettings = { version: 1; interface_language: LanguageCode; translation_languages: LanguageCode[] }
export type MarkdownTranslation = { protocol: 'harness.utility/v1'; task: 'translate_markdown'; target_language: LanguageCode; markdown: string }
