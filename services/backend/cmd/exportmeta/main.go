package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"kernl.local/harness/backend/internal/exportmeta"
)

func main() {
	root := flag.String("root", "", "project root")
	output := flag.String("output", "", "output EXPORTS.md path")
	kind := flag.String("kind", "make-export", "export kind")
	flag.Parse()
	if *root == "" || *output == "" {
		fmt.Fprintln(os.Stderr, "-root and -output are required")
		os.Exit(2)
	}
	meta := exportmeta.Capture(*root, *kind, time.Now().UTC())
	if *kind == "make-export" {
		runtime := exportmeta.CaptureWharnessRuntime(*root)
		meta.Runtime = &runtime
	}
	if err := os.MkdirAll(filepath.Dir(*output), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "prepare output directory: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*output, meta.Markdown(), 0o600); err != nil {
		fmt.Fprintf(os.Stderr, "write export metadata: %v\n", err)
		os.Exit(1)
	}
}
