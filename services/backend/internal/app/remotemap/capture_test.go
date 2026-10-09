package remotemap_test

import (
	"context"
	"errors"
	"os"
	"sync"

	"kernl.local/harness/backend/internal/app"
)

type channelCapture struct {
	mu      sync.Mutex
	mapJSON []byte
}

func (*channelCapture) Status() app.RemoteInputStatus {
	return app.RemoteInputStatus{Enabled: true, Mode: "tunnel", Provider: "trycloudflare"}
}

func (*channelCapture) Publish(context.Context, app.RemoteInputObject) (app.RemoteInputPublication, error) {
	return app.RemoteInputPublication{}, errors.New("expected live channel")
}

func (*channelCapture) SupportsRemoteInputChannels() bool { return true }

func (c *channelCapture) PublishRemoteInputChannel(_ context.Context, channel app.RemoteInputChannel) (app.RemoteInputPublication, error) {
	if err := c.capture(channel.Resources); err != nil {
		return app.RemoteInputPublication{}, err
	}
	return app.RemoteInputPublication{Provider: "trycloudflare", InstanceID: "test", URL: "https://test.invalid/" + channel.ChannelID + "/manifest.json"}, nil
}

func (c *channelCapture) UpdateRemoteInputChannel(_ context.Context, _ string, update app.RemoteInputChannelUpdate) error {
	return c.capture(update.Resources)
}

func (*channelCapture) CloseRemoteInputChannel(context.Context, string, string) error { return nil }

func (c *channelCapture) capture(resources []app.RemoteInputChannelResource) error {
	for _, resource := range resources {
		if resource.Path != "file-map.json" {
			continue
		}
		raw, err := os.ReadFile(resource.FilePath)
		if err != nil {
			return err
		}
		c.mu.Lock()
		c.mapJSON = raw
		c.mu.Unlock()
	}
	return nil
}

func (c *channelCapture) snapshot() []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]byte(nil), c.mapJSON...)
}
