export const ARTIFACT_LIBRARY_GRID_CLASS = 'file-library-grid grid min-h-0 min-w-0 flex-1 auto-rows-max content-start grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3 overflow-auto [scrollbar-gutter:stable] p-3'

export const ARTIFACT_LIBRARY_CARD_CLASS = 'file-library-card group relative grid min-w-0 overflow-hidden rounded-lg border border-whx-border-soft bg-whx-surface transition-[border-color,background-color] motion-reduce:transition-none hover:border-whx-border hover:bg-whx-hover'

export const ARTIFACT_LIBRARY_FILE_CARD_CLASS = 'min-h-[220px] grid-rows-[122px_auto_40px]'

export const ARTIFACT_LIBRARY_BUNDLE_CARD_CLASS = 'file-library-bundle-card aspect-[4/3] min-h-[192px] grid-rows-[minmax(84px,1fr)_auto_40px]'

export const ARTIFACT_LIBRARY_SELECTED_CARD_CLASS = 'selected border-whx-accent bg-[color-mix(in_srgb,var(--theme-accent)_4%,var(--theme-surface))] shadow-[inset_2px_0_var(--theme-accent)]'

export const ARTIFACT_LIBRARY_PREVIEW_CLASS = 'file-library-card-preview relative min-h-0 min-w-0 overflow-hidden border-0 border-b border-whx-border-soft bg-whx-bg p-0 text-left [&_.artifact-preview-empty]:!min-h-full [&_.artifact-preview-empty]:!p-3 [&_.artifact-media-preview]:!h-full [&_.artifact-media-preview]:!w-full [&_.artifact-media-preview_img]:!h-full [&_.artifact-media-preview_img]:!w-full [&_.artifact-media-preview_img]:!object-cover [&_.artifact-media-preview_video]:!h-full [&_.artifact-media-preview_video]:!w-full [&_.artifact-media-preview_video]:!object-cover [&_.artifact-text-preview]:!h-full [&_.artifact-text-preview]:!overflow-hidden [&_.artifact-text-preview]:!text-left [&_.artifact-document-frame]:!h-full [&_.artifact-document-frame]:!w-full'
