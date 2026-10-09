package remotemap

type Entry struct {
	Path        string `json:"path"`
	URL         string `json:"url"`
	SHA256      string `json:"sha256"`
	Bytes       int64  `json:"bytes"`
	ContentType string `json:"content_type"`
	Role        string `json:"role"`
	Selected    bool   `json:"selected,omitempty"`
}

type Resource struct {
	Path         string
	FilePath     string
	ContentType  string
	Bytes        int64
	ArchivePath  string
	ArchiveEntry string
	ArchiveID    string
}

type File struct {
	Role     string
	Path     string
	Raw      []byte
	Selected bool
}
